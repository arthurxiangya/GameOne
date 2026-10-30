import {
  ACTION_SERVICE,
  MONSTERS,
  Mulberry32,
  NPC_INTERACT_RANGE,
  CLASSES,
  CLASS_CHANGE_RADIUS,
  OUT_OF_COMBAT_SECONDS,
  PHYSICS,
  REGEN,
  SIM_DT,
  SPEC_LEVEL,
  TALENTS,
  TALENT_LEVELS,
  TITLES,
  bountiesForDay,
  dayNumber,
  findNpc,
  activePetBonus,
  isVisiting,
  mountSpeed,
  sanitizeIntent,
  stepPlayer,
  type ChainId,
  type GearOp,
  type GeneratedWorld,
  type InputFrame,
  type Landmark,
  type ModeState,
  type MonsterAnim,
  type MonsterType,
  type MountId,
  type NpcAction,
  type NpcDef,
  type NpcId,
  type PetId,
  type PlayerProgress,
  type RandomSource,
  type ShopItemId,
  type SiegeState,
  type ClassId,
  type SkillDef,
  type SkillId,
  type SpecId,
  type TitleId,
  type Vec3,
  type VoxelWorld,
} from '@lanternwood/shared';
import { Monster, type MonsterOptions } from '../domain/entities/monster';
import { Player } from '../domain/entities/player';
import { EventBuffer, type RoutedEvent } from '../domain/events';
import type { Calendar, Clock } from '../domain/ports';
import { fail, ok, type Result } from '../domain/result';
import { BountyService } from '../domain/services/bounty-service';
import { CombatService, type CombatWorld } from '../domain/services/combat-service';
import { GearService } from '../domain/services/gear-service';
import { MonsterAi, type AiWorld } from '../domain/services/monster-ai';
import { MountService } from '../domain/services/mount-service';
import { PetService } from '../domain/services/pet-service';
import { ProgressTracker } from '../domain/services/progress-tracker';
import { ProgressionService } from '../domain/services/progression-service';
import { ShopService } from '../domain/services/shop-service';
import { StoryService } from '../domain/services/story-service';
import type { LeaderboardSink } from './leaderboards';
import { Duels } from './modes/duels';
import { EmberRun } from './modes/ember-run';
import { LanternNight } from './modes/lantern-night';
import { RiftTrials } from './modes/rift-trials';
import type { GameMode, ModeHost } from './modes/game-mode';
import { SpatialHash } from './spatial-hash';

export type PlayerCommand =
  | { readonly kind: 'skill'; readonly skill: SkillId; readonly target: number | null }
  | { readonly kind: 'npc'; readonly npc: NpcId; readonly action: NpcAction; readonly arg: string | null }
  | { readonly kind: 'title'; readonly title: TitleId | null }
  | { readonly kind: 'class'; readonly cls: ClassId; readonly spec: SpecId | null }
  | { readonly kind: 'talent'; readonly row: number; readonly pick: number | null }
  | { readonly kind: 'gear'; readonly op: GearOp }
  | { readonly kind: 'mount'; readonly on: boolean }
  | { readonly kind: 'chooseMount'; readonly mount: MountId | null }
  | { readonly kind: 'choosePet'; readonly pet: PetId | null }
  | { readonly kind: 'renamePet'; readonly pet: PetId; readonly name: string }
  | { readonly kind: 'quit' }
  | { readonly kind: 'duel'; readonly action: 'challenge'; readonly target: number }
  | { readonly kind: 'duel'; readonly action: 'accept' | 'decline' }
  | { readonly kind: 'respawn' };

export interface GameWorldOptions {
  readonly generated: GeneratedWorld;
  readonly rng: RandomSource;
  readonly dayLengthSeconds: number;
  readonly startTimeOfDay?: number;
  /** Calendar for daily bounties. Defaults to the system clock. */
  readonly calendar?: Calendar;
  /** Where modes post results. Defaults to nowhere. */
  readonly boards?: LeaderboardSink;
  /** Whether heroes can duel (online). Single-player has nobody to duel. Defaults to true. */
  readonly duels?: boolean;
  /**
   * Loot rolls on its own stream, so a drop never shifts a fight's crits and spreads. Defaults
   * to one seeded from the world.
   */
  readonly lootRng?: RandomSource;
}

const systemCalendar: Calendar = { today: () => dayNumber(Date.now()), iso: () => new Date().toISOString() };
const noBoards: LeaderboardSink = { submit: () => null };

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
/** Landmark visits and the calendar are checked this often, in ticks. */
const SLOW_CHECK_TICKS = 10;
/** Monsters spawned by modes stay this long after dying, so clients can play the death animation. */
const TRANSIENT_CORPSE_SECONDS = 1.6;

/**
 * The authoritative simulation. Owns every entity, applies validated player input and
 * commands, runs monster AI on a fixed step, and collects the events each tick produced.
 * It knows nothing about sockets or storage.
 */
export class GameWorld implements CombatWorld, AiWorld {
  readonly emberRun: EmberRun;
  readonly lanternNight: LanternNight;
  readonly riftTrials: RiftTrials;
  readonly duels: Duels;
  readonly raceCourse: GeneratedWorld['raceCourse'];
  readonly voxels: VoxelWorld;
  readonly seed: number;
  readonly npcs: readonly NpcDef[];
  readonly landmarks: readonly Landmark[];
  private readonly spawnPoint: GeneratedWorld['playerSpawn'];
  private readonly playersById = new Map<number, Player>();
  private readonly monstersById = new Map<number, Monster>();
  private readonly playerGrid = new SpatialHash<Player>(GRID_CELL, (p) => p.body.x, (p) => p.body.z);
  private readonly monsterGrid = new SpatialHash<Monster>(GRID_CELL, (m) => m.x, (m) => m.z);
  private readonly events = new EventBuffer();
  private readonly clock: Clock = { now: () => this.simTime };
  private readonly combat: CombatService;
  private readonly ai: MonsterAi;
  private readonly story: StoryService;
  private readonly bounties: BountyService;
  private readonly tracker: ProgressTracker;
  private readonly shop: ShopService;
  private readonly gear: GearService;
  private readonly mounts: MountService;
  private readonly pets: PetService;
  private readonly calendar: Calendar;
  private readonly modes: readonly GameMode[];
  private today: number;
  private nextEntityId = 1;
  private tickCount = 0;
  private simTime = 0;
  private dayTime: number;

  constructor(private readonly options: GameWorldOptions) {
    const { generated, rng } = options;
    this.voxels = generated.world;
    this.seed = generated.seed;
    this.npcs = generated.npcs;
    this.landmarks = generated.landmarks;
    this.spawnPoint = generated.playerSpawn;
    this.dayTime = options.startTimeOfDay ?? 0.33;
    this.calendar = options.calendar ?? systemCalendar;
    this.today = this.calendar.today();

    const progression = new ProgressionService(this.events);
    this.story = new StoryService(this.events, progression, rng);
    const duels = options.duels ?? true;
    this.bounties = new BountyService(this.events, progression, (day) => bountiesForDay(generated.seed, day, { duels }));
    this.pets = new PetService(this.events, rng);
    this.mounts = new MountService(this.events, this.clock);
    this.tracker = new ProgressTracker(this.story, this.bounties, this.pets, this.calendar);
    this.shop = new ShopService(this.events, progression, this.pets);
    this.gear = new GearService(this.events, options.lootRng ?? new Mulberry32((generated.seed ^ 0x6c0071) >>> 0));
    const host: ModeHost = {
      events: this.events,
      achievements: this.tracker,
      progression,
      boards: options.boards ?? noBoards,
      calendar: this.calendar,
      rng,
      dayLengthSeconds: options.dayLengthSeconds,
      now: () => this.simTime,
      timeOfDay: () => this.dayTime,
      players: () => this.playersById.values(),
      busy: (player) => this.modes.some((mode) => mode.status(player) !== null),
      teleport: (player, to) => this.teleport(player, to),
      sendHome: (player) => this.teleport(player, this.spawnPoint),
      modeChanged: (player) => void (player.modeDirty = true),
      spawnMonster: (type, level, x, z, monsterOptions) => this.spawnMonster(type, level, x, z, monsterOptions),
      removeMonster: (m) => void this.monstersById.delete(m.id),
      grantPet: (player, pet) => this.pets.grant(player, pet),
    };
    this.raceCourse = generated.raceCourse;
    this.emberRun = new EmberRun(host, generated.raceCourse);
    this.lanternNight = new LanternNight(host, generated.siegeGates);
    this.riftTrials = new RiftTrials(host, generated.riftArenas);
    this.duels = new Duels(host, () =>
      !duels ? 'There is nobody to duel here.' : this.lanternNight.active ? 'Not during Lantern Night: the Lantern needs every blade.' : null,
    );
    this.modes = [this.emberRun, this.lanternNight, this.riftTrials, this.duels];
    this.combat = new CombatService(this, rng, this.clock, this.events, progression, this.tracker, this.gear);
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
    this.bounties.refresh(player, this.today);
    this.playersById.set(player.id, player);
    this.playerGrid.rebuild(this.playersById.values());
    return player;
  }

  removePlayer(id: number): Player | undefined {
    const player = this.playersById.get(id);
    if (!player) return undefined;
    this.playersById.delete(id);
    for (const mode of this.modes) mode.onPlayerRemoved?.(player);
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

  /**
   * Grants input credit for real time the simulation skipped (the loop fell behind). Clients keep
   * sending input in real time, so without this their input would be judged stale and dropped.
   */
  creditRealTime(seconds: number): void {
    const frames = seconds / SIM_DT;
    for (const player of this.playersById.values()) player.inputCredit = Math.min(MAX_INPUT_CREDIT, player.inputCredit + frames);
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
        result = this.interact(player, command.npc, command.action, command.arg);
        break;
      case 'title':
        result = this.chooseTitle(player, command.title);
        break;
      case 'class':
        result = this.changeClass(player, command.cls, command.spec);
        break;
      case 'talent':
        result = this.chooseTalent(player, command.row, command.pick);
        break;
      case 'gear':
        result = this.gearAction(player, command.op);
        break;
      case 'mount':
        result = command.on ? this.callMount(player) : this.mounts.dismiss(player);
        break;
      case 'quit':
        result = this.modes.some((mode) => mode.quit?.(player)) ? ok() : fail('There is nothing to give up.');
        break;
      case 'duel':
        result = command.action === 'challenge'
          ? this.duels.challenge(player, this.playersById.get(command.target))
          : this.duels.answer(player, command.action === 'accept');
        break;
      case 'chooseMount':
        result = this.mounts.choose(player, command.mount);
        break;
      case 'choosePet':
        result = this.pets.choose(player, command.pet);
        break;
      case 'renamePet':
        result = this.pets.rename(player, command.pet, command.name);
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
    if (this.tickCount % SLOW_CHECK_TICKS === 0) this.slowChecks();

    this.combat.update(dt);
    this.combat.updateStatuses(dt, this.playersById.values(), this.monstersById.values());
    for (const m of this.monstersById.values()) {
      const asleep = m.alive && m.mode === 'idle' && !m.goal && this.playerGrid.query(m.x, m.z, SIMULATION_RADIUS).length === 0;
      if (!asleep) this.ai.update(m, dt);
      if (m.transient && !m.alive && m.deadFor > TRANSIENT_CORPSE_SECONDS) this.monstersById.delete(m.id);
    }
    this.monsterGrid.rebuild(this.monstersById.values());
    for (const mode of this.modes) mode.step(dt);
  }

  // ------------------------------------------------------------------ rules from modes

  /** The hero's state in whichever mode they are in, for their HUD. */
  modeStatus(player: Player): ModeState | null {
    for (const mode of this.modes) {
      const status = mode.status(player);
      if (status) return status;
    }
    return null;
  }

  skillBlocked(player: Player, skill: SkillDef): string | null {
    for (const mode of this.modes) {
      const reason = mode.skillBlocked?.(player, skill);
      if (reason) return reason;
    }
    return null;
  }

  ignoredByMonsters(player: Player): boolean {
    return this.modes.some((mode) => mode.ignoredByMonsters?.(player));
  }

  duelOpponent(player: Player): Player | null {
    return this.duels.opponent(player);
  }

  duelDown(winner: Player, loser: Player): void {
    this.duels.down(winner, loser);
  }

  monsterHit(monster: Monster, attacker: Player | null, amount: number, killed: boolean): void {
    for (const mode of this.modes) mode.onMonsterHit?.(monster, attacker, amount, killed);
  }

  strikeGoal(monster: Monster, amount: number): void {
    for (const mode of this.modes) mode.onGoalStruck?.(monster, amount);
  }

  /** The current siege for everyone, or null. */
  siegeStatus(): SiegeState | null {
    return this.lanternNight.state();
  }

  /** A siege update to broadcast this tick, or `undefined` if nothing changed. */
  takeSiegeUpdate(): SiegeState | null | undefined {
    return this.lanternNight.takeUpdate();
  }

  /** Adds a monster for a mode. It joins the spatial grid at the end of the tick. */
  spawnMonster(type: MonsterType, level: number, x: number, z: number, options: MonsterOptions = {}): Monster {
    const def = MONSTERS[type];
    const m = new Monster(this.nextEntityId++, type, level, x, z, this.voxels.surfaceY(x, z), def.scale ?? 1, options);
    m.yaw = Math.atan2(-x, -z);
    this.monstersById.set(m.id, m);
    return m;
  }

  /**
   * Class changes happen in Emberhold, out of combat; spec changes anywhere out of combat. Both
   * are free, and outside a mode activity, so a choice never traps anyone.
   */
  private changeClass(player: Player, cls: ClassId, spec: SpecId | null): Result {
    if (player.dead) return fail('You are defeated.');
    const now = this.simTime;
    if (now - player.lastHurtAt < OUT_OF_COMBAT_SECONDS || now - player.lastAttackAt < OUT_OF_COMBAT_SECONDS) return fail('Not while fighting.');
    if (this.modes.some((mode) => mode.status(player) !== null)) return fail('Finish what you are doing first.');
    if (spec !== null && player.level < SPEC_LEVEL) return fail(`Specializations open at level ${SPEC_LEVEL}.`);
    const changingClass = cls !== player.cls;
    if (changingClass && Math.hypot(player.body.x - this.spawnPoint.x, player.body.z - this.spawnPoint.z) > CLASS_CHANGE_RADIUS) {
      return fail('Change class in Emberhold, near the fountain.');
    }
    if (!changingClass && (player.progress.specs[cls] ?? null) === spec) return ok();
    player.switchClass(() => {
      player.progress.cls = cls;
      if (spec) player.progress.specs[cls] = spec;
      else delete player.progress.specs[cls];
    });
    player.touchProgress();
    const chosen = player.spec;
    this.events.player(player.id, {
      e: 'log',
      text: changingClass ? `You are now a ${CLASSES[cls].name}${chosen ? ` (${chosen.name})` : ''}.` : `Specialization: ${chosen?.name ?? 'none'}.`,
      c: 'good',
    });
    return ok();
  }

  /**
   * Gear actions. Salvaging works anywhere; anything that changes what you wear waits until you
   * are out of combat and outside a mode, like talents; the forge's work needs Smith Oda.
   */
  private gearAction(player: Player, op: GearOp): Result {
    if (player.dead) return fail('You are defeated.');
    if (op.kind === 'salvage') return this.gear.salvage(player, op.items);
    const now = this.simTime;
    if (now - player.lastHurtAt < OUT_OF_COMBAT_SECONDS || now - player.lastAttackAt < OUT_OF_COMBAT_SECONDS) return fail('Not while fighting.');
    if (this.modes.some((mode) => mode.status(player) !== null)) return fail('Finish what you are doing first.');
    if (op.kind === 'equip') return this.gear.equip(player, op.item);
    if (op.kind === 'unequip') return this.gear.unequip(player, op.slot);
    const smith = this.npcs.find((n) => n.services.includes('forge'));
    if (!smith || Math.hypot(smith.x - player.body.x, smith.z - player.body.z) > NPC_INTERACT_RANGE + 0.5) {
      return fail(`Visit ${smith?.name ?? 'the smith'} to do that.`);
    }
    switch (op.kind) {
      case 'upgrade':
        return this.gear.upgrade(player, op.item);
      case 'reforge':
        return this.gear.reforge(player, op.item, op.affix, op.stat);
      case 'craft':
        return this.gear.craft(player, op.slot);
    }
  }

  /** A talent pick for the current class: out of combat, outside a mode, once its row is open. */
  private chooseTalent(player: Player, row: number, pick: number | null): Result {
    if (player.dead) return fail('You are defeated.');
    const now = this.simTime;
    if (now - player.lastHurtAt < OUT_OF_COMBAT_SECONDS || now - player.lastAttackAt < OUT_OF_COMBAT_SECONDS) return fail('Not while fighting.');
    if (this.modes.some((mode) => mode.status(player) !== null)) return fail('Finish what you are doing first.');
    const needed = TALENT_LEVELS[row];
    const options = TALENTS[player.cls][row];
    if (needed === undefined || !options) return fail('There is no such talent.');
    if (player.level < needed) return fail(`That row opens at level ${needed}.`);
    const talent = pick === null ? null : options[pick];
    if (pick !== null && !talent) return fail('There is no such talent.');
    const picks = [...(player.progress.talents[player.cls] ?? [null, null, null, null])];
    while (picks.length < TALENT_LEVELS.length) picks.push(null);
    if (picks[row] === (talent?.id ?? null)) return ok();
    player.switchClass(() => {
      picks[row] = talent?.id ?? null;
      player.progress.talents[player.cls] = picks;
    });
    player.touchProgress();
    this.events.player(player.id, { e: 'log', text: talent ? `Talent: ${talent.name}.` : 'Talent cleared.', c: 'good' });
    return ok();
  }

  private callMount(player: Player): Result {
    for (const mode of this.modes) {
      const reason = mode.mountBlocked?.(player);
      if (reason) return fail(reason);
    }
    return this.mounts.call(player);
  }

  private teleport(player: Player, to: Readonly<Vec3>): void {
    player.teleport(to);
    player.inputQueue.length = 0;
  }

  drainEvents(): RoutedEvent[] {
    return this.events.drain();
  }

  // ------------------------------------------------------------------ internals

  private stepPlayer(player: Player, dt: number): void {
    const recovery = dt * (1 + (player.passive.haste ?? 0));
    for (const [id, left] of player.cooldowns) {
      if (left <= recovery) player.cooldowns.delete(id);
      else player.cooldowns.set(id, left - recovery);
    }

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

    this.mounts.update(player, dt);
    if (player.dead) player.dismount();
    this.regenerate(player, dt);
    if (player.body.y < PHYSICS.killPlaneY) this.rescueFallenPlayer(player);
  }

  private applyInput(player: Player, frame: InputFrame): void {
    const intent = sanitizeIntent(frame.fwd, frame.strafe, frame.yaw);
    const still = player.dead || this.modes.some((mode) => mode.frozen?.(player));
    const result = stepPlayer(
      this.voxels,
      player.body,
      still
        ? { fwd: 0, strafe: 0, yaw: intent.yaw, jump: false, swim: false }
        : { ...intent, jump: frame.jump, swim: frame.swim },
      SIM_DT,
      mountSpeed(player.riding),
    );
    if (result.moveLength > 0.1) player.yaw = Math.atan2(result.moveX, result.moveZ);
  }

  private regenerate(player: Player, dt: number): void {
    if (player.dead) return;
    const recentlyHurt = this.simTime - player.lastHurtAt < REGEN.healthDelaySeconds;
    const fighting = recentlyHurt || this.simTime - player.lastAttackAt < 3;
    const resource = player.classDef.resource;
    const rate = fighting ? resource.regenInCombat : resource.regenOutOfCombat;
    // The Reed Frogling quickens any resource that refills; draining pools (Resolve, Heat) still drain.
    const boosted = rate > 0 ? rate * (1 + activePetBonus(player.progress, 'mana') + (player.passive.haste ?? 0)) : rate;
    player.mp = Math.max(0, Math.min(player.maxMp, player.mp + boosted * dt));
    if (!recentlyHurt && player.hp < player.maxHp) {
      player.hp = Math.min(player.maxHp, player.hp + player.maxHp * REGEN.healthFractionPerSecond * dt);
    }
  }

  private rescueFallenPlayer(player: Player): void {
    for (const mode of this.modes) mode.onPlayerFell?.(player);
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

  /** Arrivals at landmarks, and moving everyone onto a new day's bounties at midnight UTC. */
  private slowChecks(): void {
    const today = this.calendar.today();
    const newDay = today !== this.today;
    this.today = today;
    for (const player of this.playersById.values()) {
      if (newDay && this.bounties.refresh(player, today)) {
        this.events.player(player.id, { e: 'toast', text: 'New bounties are posted in Emberhold.' });
      }
      if (player.dead) continue;
      const { x, y, z } = player.body;
      const at = this.landmarks.find((l) => isVisiting(l, x, y, z)) ?? null;
      if (at && at.id !== player.atLandmark) this.tracker.record(player, { kind: 'visit', place: at.id });
      player.atLandmark = at?.id ?? null;
    }
  }

  private interact(player: Player, npcId: NpcId, action: NpcAction, arg: string | null): Result {
    const npc = findNpc(this.npcs, npcId);
    if (!npc) return fail('They are not here.');
    const service = ACTION_SERVICE[action];
    if (service && !npc.services.includes(service)) return fail('They cannot help you with that.');
    if (player.dead) return fail('You are defeated.');
    if (Math.hypot(npc.x - player.body.x, npc.z - player.body.z) > NPC_INTERACT_RANGE + 0.5) {
      return fail(`Walk closer to ${npc.name}.`);
    }
    switch (action) {
      case 'greet':
        this.tracker.record(player, { kind: 'greet', npc: npc.id });
        return ok();
      case 'accept':
        return this.story.accept(player, arg as ChainId, npc.id);
      case 'turnIn':
        return this.story.turnIn(player, arg as ChainId, npc.id);
      case 'talk':
        return this.story.talk(player, arg as ChainId, npc.id);
      case 'buyTonic':
        return this.shop.buyTonic(player);
      case 'buyWeapon':
        return this.gear.buyWeapon(player);
      case 'buy':
        return this.shop.buy(player, arg as ShopItemId);
      case 'race':
        return this.emberRun.start(player);
      case 'rift':
        return this.riftTrials.open(player);
    }
  }

  private chooseTitle(player: Player, title: TitleId | null): Result {
    if (title !== null && !player.progress.titles.includes(title)) return fail(`You have not earned ${TITLES[title].name} yet.`);
    player.progress.title = title;
    player.touchProgress();
    return ok();
  }

  private rebuildGrids(): void {
    this.playerGrid.rebuild(this.playersById.values());
    this.monsterGrid.rebuild(this.monstersById.values());
  }
}
