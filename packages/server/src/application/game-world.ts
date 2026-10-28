import {
  NPC_INTERACT_RANGE,
  PHYSICS,
  REGEN,
  SIM_DT,
  SKILL_IDS,
  npcById,
  sanitizeIntent,
  stepPlayer,
  type GeneratedWorld,
  type InputFrame,
  type MonsterAnim,
  type NpcAction,
  type NpcId,
  type PlayerProgress,
  type RandomSource,
  type SkillId,
  type VoxelWorld,
} from '@lanternwood/shared';
import { Monster } from '../domain/entities/monster';
import { Player } from '../domain/entities/player';
import { EventBuffer, type RoutedEvent } from '../domain/events';
import type { Clock } from '../domain/ports';
import { fail, ok, type Result } from '../domain/result';
import { CombatService, type CombatWorld } from '../domain/services/combat-service';
import { MonsterAi, type AiWorld } from '../domain/services/monster-ai';
import { ProgressionService } from '../domain/services/progression-service';
import { QuestService } from '../domain/services/quest-service';
import { ShopService } from '../domain/services/shop-service';
import { SpatialHash } from './spatial-hash';

export type PlayerCommand =
  | { readonly kind: 'skill'; readonly skill: SkillId; readonly target: number | null }
  | { readonly kind: 'npc'; readonly npc: NpcId; readonly action: NpcAction }
  | { readonly kind: 'respawn' };

export interface GameWorldOptions {
  readonly generated: GeneratedWorld;
  readonly rng: RandomSource;
  readonly dayLengthSeconds: number;
  readonly startTimeOfDay?: number;
}

/**
 * Movement is paid for with input credit: one frame per tick of real time. Credit banks up to
 * one second, so input delayed by a network hiccup is caught up as soon as it arrives instead
 * of queueing behind newer input, but nobody can move faster than real time over any window.
 */
export const MAX_INPUT_CREDIT = 20;
/** New players start with a little credit, so ordinary jitter never builds a queue. */
export const INITIAL_INPUT_CREDIT = 4;
/**
 * Input still waiting after credit runs out is stale. Beyond this many frames the oldest are
 * dropped, so a long stall costs one small correction instead of lasting delay for everyone.
 */
export const MAX_INPUT_BACKLOG = 4;
const MAX_QUEUED_INPUTS = 40;
/** Monsters further than this from every player sleep. */
const SIMULATION_RADIUS = 90;
const GRID_CELL = 16;

/**
 * The authoritative simulation. Owns every entity, applies validated player input and
 * commands, runs monster AI on a fixed step, and collects the events each tick produced.
 * It knows nothing about sockets or storage.
 */
export class GameWorld implements CombatWorld, AiWorld {
  readonly voxels: VoxelWorld;
  readonly seed: number;
  private readonly spawnPoint: GeneratedWorld['playerSpawn'];
  private readonly playersById = new Map<number, Player>();
  private readonly monstersById = new Map<number, Monster>();
  private readonly playerGrid = new SpatialHash<Player>(GRID_CELL, (p) => p.body.x, (p) => p.body.z);
  private readonly monsterGrid = new SpatialHash<Monster>(GRID_CELL, (m) => m.x, (m) => m.z);
  private readonly events = new EventBuffer();
  private readonly clock: Clock = { now: () => this.simTime };
  private readonly combat: CombatService;
  private readonly ai: MonsterAi;
  private readonly quests: QuestService;
  private readonly shop: ShopService;
  private nextEntityId = 1;
  private tickCount = 0;
  private simTime = 0;
  private dayTime: number;

  constructor(private readonly options: GameWorldOptions) {
    const { generated, rng } = options;
    this.voxels = generated.world;
    this.seed = generated.seed;
    this.spawnPoint = generated.playerSpawn;
    this.dayTime = options.startTimeOfDay ?? 0.33;

    const progression = new ProgressionService(this.events);
    this.quests = new QuestService(this.events, progression, rng);
    this.shop = new ShopService(this.events);
    this.combat = new CombatService(this, rng, this.clock, this.events, progression, this.quests);
    this.ai = new MonsterAi(this, this.combat, this.events, rng);

    for (const s of generated.monsterSpawns) {
      const scale = s.type === 'warden' ? 2.1 : 0.92 + rng.next() * 0.16;
      const m = new Monster(this.nextEntityId++, s.type, s.level, s.x, s.z, this.voxels.surfaceY(s.x, s.z), scale);
      m.yaw = rng.next() * Math.PI * 2;
      this.monstersById.set(m.id, m);
    }
    this.rebuildGrids();
  }

  get tick(): number {
    return this.tickCount;
  }

  get time(): number {
    return this.simTime;
  }

  get timeOfDay(): number {
    return this.dayTime;
  }

  get playerCount(): number {
    return this.playersById.size;
  }

  // ------------------------------------------------------------------ queries

  player(id: number): Player | undefined {
    return this.playersById.get(id);
  }

  monster(id: number): Monster | undefined {
    return this.monstersById.get(id);
  }

  players(): IterableIterator<Player> {
    return this.playersById.values();
  }

  monsters(): IterableIterator<Monster> {
    return this.monstersById.values();
  }

  playersNear(x: number, z: number, radius: number): readonly Player[] {
    return this.playerGrid.query(x, z, radius);
  }

  monstersNear(x: number, z: number, radius: number): readonly Monster[] {
    return this.monsterGrid.query(x, z, radius);
  }

  surfaceY(x: number, z: number): number {
    return this.voxels.surfaceY(x, z);
  }

  monsterAnim(m: Monster): MonsterAnim {
    if (!m.alive) return 'dead';
    if (m.windup > 0) return 'attack';
    return m.moving ? 'move' : 'idle';
  }

  // ------------------------------------------------------------------ lifecycle

  spawnPlayer(accountId: string, look: number, progress: PlayerProgress): Player {
    const player = new Player(this.nextEntityId++, accountId, look, progress, this.spawnPoint);
    player.teleport(this.spawnPoint);
    player.inputCredit = INITIAL_INPUT_CREDIT;
    this.playersById.set(player.id, player);
    this.playerGrid.rebuild(this.playersById.values());
    return player;
  }

  removePlayer(id: number): Player | undefined {
    const player = this.playersById.get(id);
    if (!player) return undefined;
    this.playersById.delete(id);
    for (const m of this.monstersById.values()) m.threat.delete(id);
    this.playerGrid.rebuild(this.playersById.values());
    return player;
  }

  // ------------------------------------------------------------------ input

  queueInput(playerId: number, frames: readonly InputFrame[]): void {
    const player = this.playersById.get(playerId);
    if (!player) return;
    for (const frame of frames) {
      if (frame.seq <= player.lastInputSeq) continue;
      player.inputQueue.push(frame);
    }
    // A client that floods inputs only loses its oldest ones; it can never move faster.
    if (player.inputQueue.length > MAX_QUEUED_INPUTS) player.inputQueue.splice(0, player.inputQueue.length - MAX_QUEUED_INPUTS);
  }

  execute(playerId: number, command: PlayerCommand): Result {
    const player = this.playersById.get(playerId);
    if (!player) return fail('You are not in the world.');
    let result: Result;
    switch (command.kind) {
      case 'skill':
        result = this.combat.useSkill(player, command.skill, command.target);
        break;
      case 'npc':
        result = this.interact(player, command.npc, command.action);
        break;
      case 'respawn':
        result = this.revive(player);
        break;
    }
    if (!result.ok) this.events.player(player.id, { e: 'toast', text: result.error });
    return result;
  }

  // ------------------------------------------------------------------ simulation

  step(dt: number): void {
    this.tickCount += 1;
    this.simTime += dt;
    this.dayTime = (this.dayTime + dt / this.options.dayLengthSeconds) % 1;

    for (const player of this.playersById.values()) this.stepPlayer(player, dt);
    this.playerGrid.rebuild(this.playersById.values());

    this.combat.update(dt);
    for (const m of this.monstersById.values()) {
      const asleep = m.alive && m.mode === 'idle' && this.playerGrid.query(m.x, m.z, SIMULATION_RADIUS).length === 0;
      if (!asleep) this.ai.update(m, dt);
    }
    this.monsterGrid.rebuild(this.monstersById.values());
  }

  drainEvents(): RoutedEvent[] {
    return this.events.drain();
  }

  // ------------------------------------------------------------------ internals

  private stepPlayer(player: Player, dt: number): void {
    for (const id of SKILL_IDS) if (player.cooldowns[id] > 0) player.cooldowns[id] = Math.max(0, player.cooldowns[id] - dt);

    player.inputCredit = Math.min(MAX_INPUT_CREDIT, player.inputCredit + dt / SIM_DT);
    while (player.inputCredit >= 1) {
      const frame = player.inputQueue.shift();
      if (!frame) break;
      player.inputCredit -= 1;
      if (frame.seq <= player.lastInputSeq) continue;
      player.lastInputSeq = frame.seq;
      this.applyInput(player, frame);
    }
    const stale = player.inputQueue.length - MAX_INPUT_BACKLOG;
    if (stale > 0) {
      // Acknowledge the skipped frames so the client reconciles straight to the server state.
      const skipped = player.inputQueue.splice(0, stale);
      player.lastInputSeq = Math.max(player.lastInputSeq, skipped[skipped.length - 1]!.seq);
    }

    this.regenerate(player, dt);
    if (player.body.y < PHYSICS.killPlaneY) this.rescueFallenPlayer(player);
  }

  private applyInput(player: Player, frame: InputFrame): void {
    const intent = sanitizeIntent(frame.fwd, frame.strafe, frame.yaw);
    const result = stepPlayer(
      this.voxels,
      player.body,
      player.dead
        ? { fwd: 0, strafe: 0, yaw: intent.yaw, jump: false, swim: false }
        : { ...intent, jump: frame.jump, swim: frame.swim },
      SIM_DT,
    );
    if (result.moveLength > 0.1) player.yaw = Math.atan2(result.moveX, result.moveZ);
  }

  private regenerate(player: Player, dt: number): void {
    if (player.dead) return;
    const recentlyHurt = this.simTime - player.lastHurtAt < REGEN.healthDelaySeconds;
    const fighting = recentlyHurt || this.simTime - player.lastAttackAt < 3;
    const manaRate = fighting ? REGEN.manaPerSecondInCombat : REGEN.manaPerSecondOutOfCombat;
    player.mp = Math.min(player.maxMp, player.mp + manaRate * dt);
    if (!recentlyHurt && player.hp < player.maxHp) {
      player.hp = Math.min(player.maxHp, player.hp + player.maxHp * REGEN.healthFractionPerSecond * dt);
    }
  }

  private rescueFallenPlayer(player: Player): void {
    player.progress.falls += 1;
    player.touchProgress();
    player.teleport(this.spawnPoint);
    player.hp = Math.max(1, Math.round(player.hp * 0.8));
    this.events.player(player.id, { e: 'respawned', fell: true });
    this.events.player(player.id, { e: 'log', text: 'You tumbled off the edge of the world.', c: 'foe' });
  }

  private revive(player: Player): Result {
    if (!player.dead) return fail('You are still standing.');
    player.dead = false;
    player.restoreVitals();
    player.teleport(this.spawnPoint);
    this.events.player(player.id, { e: 'respawned', fell: false });
    this.events.player(player.id, { e: 'log', text: 'The healers of Emberhold patch you up.', c: 'good' });
    return ok();
  }

  private interact(player: Player, npcId: NpcId, action: NpcAction): Result {
    const npc = npcById(npcId);
    if (!npc || !npc.actions.includes(action)) return fail('They cannot help you with that.');
    if (player.dead) return fail('You are defeated.');
    if (Math.hypot(npc.x - player.body.x, npc.z - player.body.z) > NPC_INTERACT_RANGE + 0.5) {
      return fail(`Walk closer to ${npc.name}.`);
    }
    switch (action) {
      case 'questAccept':
        return this.quests.accept(player);
      case 'questTurnIn':
        return this.quests.turnIn(player);
      case 'buyTonic':
        return this.shop.buyTonic(player);
      case 'sharpen':
        return this.shop.sharpen(player);
    }
  }

  private rebuildGrids(): void {
    this.playerGrid.rebuild(this.playersById.values());
    this.monsterGrid.rebuild(this.monstersById.values());
  }
}
