import {
  BOLT_SPEED,
  CRIT_CHANCE,
  DUEL,
  CRIT_MULTIPLIER,
  MEND_FRACTION,
  SIEGE,
  SKILLS,
  TONIC_DROP_CHANCE,
  activePetBonus,
  killGold,
  killXp,
  tonicHeal,
  type RandomSource,
  type SkillId,
} from '@lanternwood/shared';
import type { AchievementSink } from '../achievements';
import { sameFight, type Monster } from '../entities/monster';
import type { Player } from '../entities/player';
import type { EventSink } from '../events';
import type { Clock } from '../ports';
import { fail, ok, type Result } from '../result';
import type { ProgressionService } from './progression-service';

/** What combat needs to know about the world. Implemented by the application layer. */
export interface CombatWorld {
  monster(id: number): Monster | undefined;
  player(id: number): Player | undefined;
  monstersNear(x: number, z: number, radius: number): readonly Monster[];
  /** A reason a mode forbids this skill right now (no fighting during a run), or null. */
  skillBlocked(player: Player, skill: SkillId): string | null;
  /** A hero hit a monster (modes count damage and kills). */
  monsterHit(monster: Monster, attacker: Player | null, amount: number, killed: boolean): void;
  /** The hero's duel opponent while the fight is on, or null. A duelist can hit only them. */
  duelOpponent(player: Player): Player | null;
  /** A duelist took a hit that would have dropped them: they yield, and the duel ends. */
  duelDown(winner: Player, loser: Player): void;
}

interface PendingHit {
  remaining: number;
  readonly targetId: number;
  readonly target: 'monster' | 'player';
  readonly attackerId: number;
  readonly amount: number;
  readonly crit: boolean;
}

const VERTICAL_REACH = 5;

/** Skills, damage, healing, deaths and kill rewards. */
export class CombatService {
  private readonly pendingHits: PendingHit[] = [];

  constructor(
    private readonly world: CombatWorld,
    private readonly rng: RandomSource,
    private readonly clock: Clock,
    private readonly events: EventSink,
    private readonly progression: ProgressionService,
    private readonly achievements: AchievementSink,
  ) {}

  useSkill(player: Player, skill: SkillId, requestedTarget: number | null): Result {
    if (player.dead) return fail('You are defeated.');
    const def = SKILLS[skill];
    if (player.level < def.unlockLevel) return fail(`${def.name} unlocks at level ${def.unlockLevel}.`);
    if (player.cooldowns[skill] > 0) return fail(`${def.name} is not ready yet.`);
    if (player.mp < def.mana) return fail('Not enough mana.');
    const blocked = this.world.skillBlocked(player, skill);
    if (blocked) return fail(blocked);
    player.dismount();
    switch (skill) {
      case 'strike':
        return this.strike(player, requestedTarget);
      case 'bolt':
        return this.bolt(player, requestedTarget);
      case 'mend':
        return this.mend(player);
      case 'ring':
        return this.ring(player);
      case 'tonic':
        return this.tonic(player);
    }
  }

  /** Lands Ember Bolts whose flight time has elapsed. */
  update(dt: number): void {
    for (let i = this.pendingHits.length - 1; i >= 0; i--) {
      const hit = this.pendingHits[i]!;
      hit.remaining -= dt;
      if (hit.remaining > 0) continue;
      this.pendingHits.splice(i, 1);
      const attacker = this.world.player(hit.attackerId) ?? null;
      if (hit.target === 'player') {
        const target = this.world.player(hit.targetId);
        if (attacker && target && this.world.duelOpponent(attacker) === target) this.hitDuelist(attacker, target, hit.amount, hit.crit);
        continue;
      }
      const monster = this.world.monster(hit.targetId);
      if (monster?.alive) this.damageMonster(monster, hit.amount, hit.crit, attacker);
    }
  }

  damageMonster(monster: Monster, amount: number, crit: boolean, attacker: Player | null): void {
    if (!monster.alive) return;
    const amt = Math.max(1, Math.round(amount));
    monster.hp -= amt;
    if (attacker) monster.addThreat(attacker.id, amt);
    monster.provoke();
    this.events.area(monster.x, monster.z, { e: 'dmg', id: monster.id, amt, crit });
    const killed = monster.hp <= 0;
    if (killed) this.killMonster(monster, attacker);
    this.world.monsterHit(monster, attacker, amt, killed);
  }

  damagePlayer(player: Player, amount: number, source: Monster, kind: 'hit' | 'slam'): void {
    if (player.dead) return;
    const amt = Math.max(1, Math.round(amount));
    player.hp -= amt;
    player.lastHurtAt = this.clock.now();
    player.dismount();
    this.events.area(player.body.x, player.body.z, { e: 'dmg', id: player.id, amt, crit: false });
    this.events.player(player.id, { e: 'log', text: `${source.def.name} ${kind === 'slam' ? 'slams' : 'hits'} you for ${amt}`, c: 'foe' });
    if (player.hp <= 0) {
      player.hp = 0;
      player.dead = true;
      this.events.area(player.body.x, player.body.z, { e: 'die', id: player.id });
      this.events.player(player.id, { e: 'log', text: 'You were defeated.', c: 'foe' });
    }
  }

  /** A duel hit: scaled down so fights last, and never below 1 health. */
  private hitDuelist(attacker: Player, target: Player, amount: number, crit: boolean): void {
    const amt = Math.max(1, Math.round(amount * DUEL.damageScale));
    target.lastHurtAt = this.clock.now();
    this.events.area(target.body.x, target.body.z, { e: 'dmg', id: target.id, amt, crit });
    if (target.hp - amt <= 0) {
      target.hp = 1;
      this.world.duelDown(attacker, target);
    } else {
      target.hp -= amt;
    }
  }

  /** The duel opponent if they are within `range` (from their body edge) and roughly level with you. */
  private opponentInReach(player: Player, opponent: Player, range: number): boolean {
    const gap = Math.hypot(opponent.body.x - player.body.x, opponent.body.z - player.body.z) - 0.3;
    return gap <= range && Math.abs(opponent.body.y - player.body.y) <= VERTICAL_REACH;
  }

  private engagePlayer(player: Player, target: Player): void {
    player.yaw = Math.atan2(target.body.x - player.body.x, target.body.z - player.body.z);
    player.lastAttackAt = this.clock.now();
    this.events.player(player.id, { e: 'target', id: target.id });
  }

  // ------------------------------------------------------------------ skills

  private strike(player: Player, requested: number | null): Result {
    const def = SKILLS.strike;
    player.cooldowns.strike = def.cooldown;
    this.events.area(player.body.x, player.body.z, { e: 'swing', id: player.id });
    const opponent = this.world.duelOpponent(player);
    if (opponent) {
      if (!this.opponentInReach(player, opponent, def.range)) return fail('Too far from your opponent.');
      this.engagePlayer(player, opponent);
      const roll = this.roll(player, def.power);
      this.hitDuelist(player, opponent, roll.amount, roll.crit);
      return ok();
    }
    const target = this.resolveTarget(player, requested, def.range);
    if (!target) return fail(requested !== null ? 'Too far away. Walk closer or use Ember Bolt.' : 'Nothing in reach.');
    this.engage(player, target);
    const roll = this.roll(player, def.power);
    this.damageMonster(target, roll.amount, roll.crit, player);
    return ok();
  }

  private bolt(player: Player, requested: number | null): Result {
    const def = SKILLS.bolt;
    const opponent = this.world.duelOpponent(player);
    if (opponent) {
      if (!this.opponentInReach(player, opponent, def.range)) return fail('Your opponent is out of range.');
      this.engagePlayer(player, opponent);
      player.mp -= def.mana;
      player.cooldowns.bolt = def.cooldown;
      const flight = Math.hypot(opponent.body.x - player.body.x, opponent.body.z - player.body.z) / BOLT_SPEED;
      const roll = this.roll(player, def.power);
      this.pendingHits.push({ remaining: flight, targetId: opponent.id, target: 'player', attackerId: player.id, amount: roll.amount, crit: roll.crit });
      this.events.area(player.body.x, player.body.z, { e: 'cast', id: player.id });
      this.events.area(player.body.x, player.body.z, { e: 'bolt', from: player.id, to: opponent.id, flight });
      return ok();
    }
    const target = this.resolveTarget(player, requested, def.range);
    if (!target) return fail('No target in range.');
    this.engage(player, target);
    player.mp -= def.mana;
    player.cooldowns.bolt = def.cooldown;
    const flight = Math.hypot(target.x - player.body.x, target.z - player.body.z) / BOLT_SPEED;
    const roll = this.roll(player, def.power);
    this.pendingHits.push({ remaining: flight, targetId: target.id, target: 'monster', attackerId: player.id, amount: roll.amount, crit: roll.crit });
    this.events.area(player.body.x, player.body.z, { e: 'cast', id: player.id });
    this.events.area(player.body.x, player.body.z, { e: 'bolt', from: player.id, to: target.id, flight });
    return ok();
  }

  private mend(player: Player): Result {
    const def = SKILLS.mend;
    if (player.hp >= player.maxHp) return fail('You are already at full health.');
    player.mp -= def.mana;
    player.cooldowns.mend = def.cooldown;
    this.events.area(player.body.x, player.body.z, { e: 'cast', id: player.id });
    this.heal(player, Math.round(player.maxHp * MEND_FRACTION * (1 + activePetBonus(player.progress, 'mend'))));
    return ok();
  }

  private ring(player: Player): Result {
    const def = SKILLS.ring;
    player.mp -= def.mana;
    player.cooldowns.ring = def.cooldown;
    player.lastAttackAt = this.clock.now();
    this.events.area(player.body.x, player.body.z, { e: 'ring', id: player.id, r: def.range });
    const opponent = this.world.duelOpponent(player);
    if (opponent) {
      if (this.opponentInReach(player, opponent, def.range)) {
        const roll = this.roll(player, def.power);
        this.hitDuelist(player, opponent, roll.amount, roll.crit);
      }
      return ok();
    }
    for (const m of this.world.monstersNear(player.body.x, player.body.z, def.range + 3)) {
      if (!m.alive || !sameFight(m, player.party) || Math.abs(m.y - player.body.y) > 3 || this.reach(player, m) > def.range) continue;
      const roll = this.roll(player, def.power);
      this.damageMonster(m, roll.amount, roll.crit, player);
    }
    return ok();
  }

  private tonic(player: Player): Result {
    const p = player.progress;
    if (p.tonics <= 0) return fail('No tonics left. Smith Oda sells them.');
    if (player.hp >= player.maxHp) return fail('You are already at full health.');
    p.tonics -= 1;
    player.cooldowns.tonic = SKILLS.tonic.cooldown;
    player.touchProgress();
    this.heal(player, Math.round(tonicHeal(player.level) * (1 + activePetBonus(player.progress, 'tonicHeal'))));
    return ok();
  }

  // ------------------------------------------------------------------ helpers

  private heal(player: Player, amount: number): void {
    const before = player.hp;
    player.hp = Math.min(player.maxHp, player.hp + amount);
    this.events.area(player.body.x, player.body.z, { e: 'heal', id: player.id, amt: Math.round(player.hp - before) });
  }

  private killMonster(monster: Monster, killer: Player | null): void {
    monster.die();
    this.events.area(monster.x, monster.z, { e: 'die', id: monster.id });
    if (!killer) return;
    const blessing = killer.blessedUntil > this.clock.now() ? SIEGE.blessing : 0;
    const bonus = (kind: 'gold' | 'xp'): number => 1 + activePetBonus(killer.progress, kind) + (kind === 'xp' ? blessing : 0);
    const gold = Math.round(killGold(monster.level, monster.def.boss, this.rng.next()) * bonus('gold'));
    this.progression.grantGold(killer, gold);
    this.events.player(killer.id, { e: 'log', text: `${monster.def.name} defeated · +${gold} gold`, c: 'loot' });
    this.progression.grantXp(killer, killXp(monster.level, killer.level, monster.def.boss) * bonus('xp'));
    this.achievements.record(killer, { kind: 'kill', monster: monster.type, level: monster.level });
    if (!monster.def.boss && this.rng.next() < TONIC_DROP_CHANCE * (1 + activePetBonus(killer.progress, 'tonicDrops'))) {
      killer.progress.tonics += 1;
      killer.touchProgress();
      this.events.player(killer.id, { e: 'log', text: 'Found a healing tonic', c: 'loot' });
    }
    if (monster.def.boss) {
      this.events.area(monster.x, monster.z, { e: 'log', text: `${killer.name} defeated the ${monster.def.name}!`, c: 'sys' });
    }
  }

  /** Gap between the player and the monster's body edge. */
  private reach(player: Player, m: Monster): number {
    return Math.hypot(m.x - player.body.x, m.z - player.body.z) - m.bodyRadius;
  }

  private resolveTarget(player: Player, requested: number | null, range: number): Monster | null {
    const asked = requested !== null ? this.world.monster(requested) : undefined;
    // Someone else's rift fight is not yours to join.
    const preferred = asked && sameFight(asked, player.party) ? asked : undefined;
    if (preferred?.alive && this.reach(player, preferred) <= range && Math.abs(preferred.y - player.body.y) <= VERTICAL_REACH) {
      return preferred;
    }
    if (requested !== null && preferred?.alive) return null;
    let best: Monster | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    const fx = Math.sin(player.yaw);
    const fz = Math.cos(player.yaw);
    for (const m of this.world.monstersNear(player.body.x, player.body.z, range + 3)) {
      if (!m.alive || !sameFight(m, player.party) || Math.abs(m.y - player.body.y) > VERTICAL_REACH) continue;
      const gap = this.reach(player, m);
      if (gap > range) continue;
      const dx = m.x - player.body.x;
      const dz = m.z - player.body.z;
      const facing = (dx * fx + dz * fz) / Math.max(0.01, Math.hypot(dx, dz));
      const score = gap * (gap > 0.5 && facing < 0.2 ? 1.8 : 1);
      if (score < bestScore) {
        bestScore = score;
        best = m;
      }
    }
    return best;
  }

  private engage(player: Player, target: Monster): void {
    player.yaw = Math.atan2(target.x - player.body.x, target.z - player.body.z);
    player.lastAttackAt = this.clock.now();
    this.events.player(player.id, { e: 'target', id: target.id });
  }

  private roll(player: Player, power: number): { amount: number; crit: boolean } {
    const crit = this.rng.next() < CRIT_CHANCE;
    const spread = 0.9 + this.rng.next() * 0.2;
    return { amount: player.attack * power * spread * (crit ? CRIT_MULTIPLIER : 1), crit };
  }
}
