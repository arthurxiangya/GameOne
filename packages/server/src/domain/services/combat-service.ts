import {
  BOLT_SPEED,
  CRIT_CHANCE,
  CRIT_MULTIPLIER,
  DAMAGE_REDUCTION_CAP,
  DUEL,
  RESOURCES,
  SIEGE,
  TONIC,
  TONIC_DROP_CHANCE,
  activePetBonus,
  capModifier,
  isOffensive,
  killGold,
  killXp,
  tonicHeal,
  type RandomSource,
  type SkillDef,
  type SkillId,
  type StatusDef,
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
  playersNear(x: number, z: number, radius: number): readonly Player[];
  /** A reason a mode forbids this skill right now (no fighting during a run), or null. */
  skillBlocked(player: Player, skill: SkillDef): string | null;
  /** A hero hit a monster (modes count damage and kills). */
  monsterHit(monster: Monster, attacker: Player | null, amount: number, killed: boolean): void;
  /** The hero's duel opponent while the fight is on, or null. A duelist can hit only them. */
  duelOpponent(player: Player): Player | null;
  /** A duelist took a hit that would have dropped them: they yield, and the duel ends. */
  duelDown(winner: Player, loser: Player): void;
}

/** Something a skill can hit: a monster, or a duel opponent. */
type Foe = { readonly kind: 'monster'; readonly m: Monster } | { readonly kind: 'hero'; readonly p: Player };

interface PendingHit {
  remaining: number;
  readonly casterId: number;
  readonly skill: SkillDef;
  readonly targetId: number;
  readonly targetKind: Foe['kind'];
}

const VERTICAL_REACH = 5;
/** Area skills reach this far up or down. */
const AREA_VERTICAL = 3;
const HERO_RADIUS = 0.3;
/** A guard talent works below this share of health. */
const GUARD_BELOW = 0.35;

/**
 * Skills, damage, healing, statuses, deaths and kill rewards. Every class skill runs through
 * the same few steps: check, pay, pick who it reaches, then apply its effects in order.
 */
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

  useSkill(player: Player, id: SkillId, requestedTarget: number | null): Result {
    if (player.dead) return fail('You are defeated.');
    const def = id === 'tonic' ? TONIC : player.kit.find((s) => s.id === id);
    if (!def) return fail(`A ${player.classDef.name} doesn't know that skill.`);
    if (player.level < def.unlockLevel) return fail(`${def.name} unlocks at level ${def.unlockLevel}.`);
    if (player.cooldown(def.id) > 0) return fail(`${def.name} is not ready yet.`);
    if (player.mp < def.cost) return fail(`Not enough ${RESOURCES[player.classDef.resource.kind].name}.`);
    const blocked = this.world.skillBlocked(player, def);
    if (blocked) return fail(blocked);
    player.dismount();
    if (def === TONIC) return this.tonic(player);
    switch (def.target) {
      case 'enemy':
        return this.castAtEnemy(player, def, requestedTarget);
      case 'ally':
        return this.castAtAlly(player, def, requestedTarget);
      case 'self':
        this.pay(player, def);
        this.events.area(player.body.x, player.body.z, { e: 'cast', id: player.id });
        this.resolve(player, def, [], [player]);
        return ok();
      case 'around':
        this.pay(player, def);
        this.events.area(player.body.x, player.body.z, { e: 'ring', id: player.id, r: def.radius, c: def.color });
        this.resolve(player, def, this.foesAround(player, def.radius), this.alliesAround(player, def.radius));
        return ok();
    }
  }

  /** Lands projectiles whose flight time has elapsed. */
  update(dt: number): void {
    for (let i = this.pendingHits.length - 1; i >= 0; i--) {
      const hit = this.pendingHits[i]!;
      hit.remaining -= dt;
      if (hit.remaining > 0) continue;
      this.pendingHits.splice(i, 1);
      const caster = this.world.player(hit.casterId);
      if (!caster) continue;
      if (hit.targetKind === 'hero') {
        const target = this.world.player(hit.targetId);
        if (target && this.world.duelOpponent(caster) === target) this.resolve(caster, hit.skill, [{ kind: 'hero', p: target }], [caster]);
        continue;
      }
      const monster = this.world.monster(hit.targetId);
      if (monster?.alive) this.resolve(caster, hit.skill, this.withSplash(caster, hit.skill, monster), [caster]);
    }
  }

  /** Burns and hymns tick once a second; shields fade; expired statuses go. */
  updateStatuses(dt: number, players: Iterable<Player>, monsters: Iterable<Monster>): void {
    const now = this.clock.now();
    for (const m of monsters) {
      if (m.statuses.size === 0) continue;
      for (const s of m.statuses.ticking()) {
        s.carry += dt;
        if (s.carry < 1) continue;
        s.carry -= 1;
        s.ticksLeft -= 1;
        if (!m.alive) continue;
        const source = this.world.player(s.sourceId) ?? null;
        this.damageMonster(m, s.perSecond * (1 + capModifier(m.statuses.sum('damageTaken', now))), false, source);
      }
      m.statuses.expire(now);
    }
    for (const p of players) {
      if (p.shield > 0 && now >= p.shieldUntil) p.shield = 0;
      if (p.statuses.size === 0) continue;
      for (const s of p.statuses.ticking()) {
        s.carry += dt;
        if (s.carry < 1) continue;
        s.carry -= 1;
        s.ticksLeft -= 1;
        if (p.dead) continue;
        if (s.def.hot) this.heal(p, s.perSecond);
        if (s.def.dot) {
          const source = this.world.player(s.sourceId);
          if (source && this.world.duelOpponent(source) === p) this.hitDuelist(source, p, s.perSecond, false);
        }
      }
      p.statuses.expire(now);
    }
  }

  damageMonster(monster: Monster, amount: number, crit: boolean, attacker: Player | null): void {
    if (!monster.alive) return;
    const amt = Math.max(1, Math.round(amount));
    monster.hp -= amt;
    if (attacker) monster.addThreat(attacker.id, amt * attacker.classDef.threat);
    monster.provoke();
    this.events.area(monster.x, monster.z, { e: 'dmg', id: monster.id, amt, crit });
    const killed = monster.hp <= 0;
    if (killed) this.killMonster(monster, attacker);
    this.world.monsterHit(monster, attacker, amt, killed);
  }

  damagePlayer(player: Player, amount: number, source: Monster, kind: 'hit' | 'slam'): void {
    if (player.dead) return;
    const amt = this.absorb(player, Math.max(1, Math.round(this.mitigate(player, amount))));
    player.lastHurtAt = this.clock.now();
    player.dismount();
    this.gainOnHitTaken(player);
    this.events.area(player.body.x, player.body.z, { e: 'dmg', id: player.id, amt, crit: false });
    this.events.player(player.id, { e: 'log', text: `${source.def.name} ${kind === 'slam' ? 'slams' : 'hits'} you for ${amt}`, c: 'foe' });
    player.hp -= amt;
    if (player.hp <= 0) {
      player.hp = 0;
      player.dead = true;
      player.statuses.clear();
      player.shield = 0;
      this.events.area(player.body.x, player.body.z, { e: 'die', id: player.id });
      this.events.player(player.id, { e: 'log', text: 'You were defeated.', c: 'foe' });
    }
  }

  // ------------------------------------------------------------------ casting

  private castAtEnemy(player: Player, def: SkillDef, requested: number | null): Result {
    const opponent = this.world.duelOpponent(player);
    let foe: Foe;
    if (opponent) {
      if (this.gap(player, opponent.body.x, opponent.body.y, opponent.body.z, HERO_RADIUS) > def.range) return fail('Your opponent is out of reach.');
      foe = { kind: 'hero', p: opponent };
    } else {
      const m = this.resolveTarget(player, requested, def.range);
      if (!m) {
        if (requested === null) return fail(def.delivery === 'melee' ? 'Nothing in reach.' : 'No target in range.');
        return fail(def.delivery === 'melee' ? 'Too far away. Walk closer.' : 'Out of range.');
      }
      foe = { kind: 'monster', m };
    }
    const at = foe.kind === 'monster' ? foe.m : { x: foe.p.body.x, z: foe.p.body.z };
    player.yaw = Math.atan2(at.x - player.body.x, at.z - player.body.z);
    this.events.player(player.id, { e: 'target', id: foe.kind === 'monster' ? foe.m.id : foe.p.id });
    this.pay(player, def);
    const targetId = foe.kind === 'monster' ? foe.m.id : foe.p.id;
    if (def.delivery === 'projectile') {
      const flight = Math.hypot(at.x - player.body.x, at.z - player.body.z) / BOLT_SPEED;
      this.pendingHits.push({ remaining: flight, casterId: player.id, skill: def, targetId, targetKind: foe.kind });
      this.events.area(player.body.x, player.body.z, { e: 'cast', id: player.id });
      this.events.area(player.body.x, player.body.z, { e: 'bolt', from: player.id, to: targetId, flight, c: def.color });
      return ok();
    }
    this.events.area(player.body.x, player.body.z, def.delivery === 'melee' ? { e: 'swing', id: player.id } : { e: 'cast', id: player.id });
    this.resolve(player, def, foe.kind === 'monster' ? this.withSplash(player, def, foe.m) : [foe], [player]);
    return ok();
  }

  private castAtAlly(player: Player, def: SkillDef, requested: number | null): Result {
    let target = player;
    const other = requested !== null && requested !== player.id ? this.world.player(requested) : undefined;
    if (other && !other.dead && this.canHelp(player, other)) {
      if (this.gap(player, other.body.x, other.body.y, other.body.z, HERO_RADIUS) > def.range) return fail(`${other.name} is too far away.`);
      target = other;
    }
    this.pay(player, def);
    this.events.area(player.body.x, player.body.z, { e: 'cast', id: player.id });
    this.resolve(player, def, [], [target]);
    return ok();
  }

  private pay(player: Player, def: SkillDef): void {
    player.mp = Math.min(player.maxMp, player.mp - def.cost + def.gain);
    player.cooldowns.set(def.id, def.cooldown);
    if (isOffensive(def)) player.lastAttackAt = this.clock.now();
  }

  /** Applies a skill's effects, in order, to the enemies and allies it reached. */
  private resolve(caster: Player, def: SkillDef, foes: readonly Foe[], allies: readonly Player[]): void {
    const now = this.clock.now();
    const multi = foes.length >= 2;
    let dealt = 0;
    for (const effect of def.effects) {
      switch (effect.kind) {
        case 'damage':
          // An enemy skill's first foe is its target; the rest take the splash share.
          foes.forEach((foe, i) => {
            dealt += this.hit(caster, def, foe, effect.k * (def.target === 'enemy' && i > 0 ? def.splash : 1), multi);
          });
          break;
        case 'heal':
          for (const t of effect.to === 'self' ? [caster] : allies) {
            const amount = caster.attack * (effect.k ?? 0) + t.maxHp * (effect.maxHp ?? 0);
            this.heal(t, amount * this.healingMultiplier(caster));
          }
          break;
        case 'shield':
          for (const t of effect.to === 'self' ? [caster] : allies) {
            t.shield = Math.max(t.shield, Math.round(caster.attack * effect.k * this.healingMultiplier(caster)));
            t.shieldUntil = now + effect.seconds;
            this.events.area(t.body.x, t.body.z, { e: 'fx', id: t.id, text: `${def.name} ${t.shield}`, good: true });
          }
          break;
        case 'status': {
          if (effect.to === 'enemies') {
            for (const foe of foes) this.afflict(caster, foe, effect.status);
          } else {
            const targets = effect.to === 'self' ? [caster] : effect.to === 'others' ? allies.filter((a) => a !== caster) : allies;
            for (const t of targets) this.bless(caster, t, effect.status);
          }
          break;
        }
        case 'taunt':
          for (const foe of foes) if (foe.kind === 'monster' && foe.m.alive) foe.m.taunt(caster.id, now + effect.seconds);
          break;
      }
    }
    if (def.leech > 0 && dealt > 0 && !caster.dead) this.heal(caster, dealt * def.leech);
  }

  /** A status on an enemy: slows, stuns and burns on monsters; only damage-taken and burns reach duelists. */
  private afflict(caster: Player, foe: Foe, status: StatusDef): void {
    const now = this.clock.now();
    const perSecond = status.dot ? (caster.attack * status.dot * (1 + this.damageBonus(caster, foe, false))) / status.seconds : 0;
    if (foe.kind === 'monster') {
      if (!foe.m.alive || (status.stun && foe.m.def.boss)) return;
      foe.m.statuses.apply(status, now, caster.id, perSecond);
      this.events.area(foe.m.x, foe.m.z, { e: 'fx', id: foe.m.id, text: status.name, good: false });
    } else {
      foe.p.statuses.apply(status, now, caster.id, perSecond);
      this.events.area(foe.p.body.x, foe.p.body.z, { e: 'fx', id: foe.p.id, text: status.name, good: false });
    }
  }

  private bless(caster: Player, target: Player, status: StatusDef): void {
    const perSecond = status.hot ? (caster.attack * status.hot * this.healingMultiplier(caster)) / status.seconds : 0;
    target.statuses.apply(status, this.clock.now(), caster.id, perSecond);
    this.events.area(target.body.x, target.body.z, { e: 'fx', id: target.id, text: status.name, good: true });
  }

  /** Rolls and lands one hit; returns the damage done. */
  private hit(caster: Player, def: SkillDef, foe: Foe, k: number, multi: boolean): number {
    const crit = this.rng.next() < CRIT_CHANCE + (caster.passive.crit ?? 0) + def.crit;
    const spread = 0.9 + this.rng.next() * 0.2;
    const amount = caster.attack * k * spread * (crit ? CRIT_MULTIPLIER : 1) * (1 + this.damageBonus(caster, foe, multi));
    if (foe.kind === 'hero') {
      this.hitDuelist(caster, foe.p, amount, crit);
      return amount * DUEL.damageScale;
    }
    if (!foe.m.alive) return 0;
    const landed = amount * (1 + capModifier(foe.m.statuses.sum('damageTaken', this.clock.now())));
    this.damageMonster(foe.m, landed, crit, caster);
    return landed;
  }

  /** The caster's damage modifiers against this foe: spec passive, statuses, multi-target and slowed bonuses. */
  private damageBonus(caster: Player, foe: Foe, multi: boolean): number {
    const p = caster.passive;
    const now = this.clock.now();
    const slowed = foe.kind === 'monster' && foe.m.statuses.slow(now) > 0;
    return capModifier((p.damage ?? 0) + caster.statuses.sum('damageDealt', now) + (multi ? p.multiTarget ?? 0 : 0) + (slowed ? p.vsSlowed ?? 0 : 0));
  }

  private healingMultiplier(caster: Player): number {
    return (1 + capModifier(caster.passive.healing ?? 0)) * (1 + activePetBonus(caster.progress, 'healing'));
  }

  /** A duel hit: scaled down so fights last, mitigated like any hit, and never below 1 health. */
  private hitDuelist(attacker: Player, target: Player, amount: number, crit: boolean): void {
    const amt = this.absorb(target, Math.max(1, Math.round(this.mitigate(target, amount * DUEL.damageScale))));
    target.lastHurtAt = this.clock.now();
    attacker.lastAttackAt = this.clock.now();
    this.gainOnHitTaken(target);
    this.events.area(target.body.x, target.body.z, { e: 'dmg', id: target.id, amt, crit });
    if (target.hp - amt <= 0) {
      target.hp = 1;
      this.world.duelDown(attacker, target);
    } else {
      target.hp -= amt;
    }
  }

  /** Armour, damage-taken statuses and a low-health guard, never more than 60% off together. */
  private mitigate(player: Player, amount: number): number {
    const guard = player.hp < player.maxHp * GUARD_BELOW ? player.passive.guard ?? 0 : 0;
    const taken = (1 - player.armor) * (1 + capModifier(player.statuses.sum('damageTaken', this.clock.now()))) * (1 - guard);
    return amount * Math.max(1 - DAMAGE_REDUCTION_CAP, taken);
  }

  /** A ward soaks damage first. Returns what gets through. */
  private absorb(player: Player, amount: number): number {
    if (player.shield <= 0 || this.clock.now() >= player.shieldUntil) return amount;
    const soaked = Math.min(player.shield, amount);
    player.shield -= soaked;
    return amount - soaked;
  }

  private gainOnHitTaken(player: Player): void {
    const gain = player.classDef.resource.perHitTaken;
    if (gain > 0) player.mp = Math.min(player.maxMp, player.mp + gain);
  }

  // ------------------------------------------------------------------ the tonic

  private tonic(player: Player): Result {
    const p = player.progress;
    if (p.tonics <= 0) return fail('No tonics left. Smith Oda sells them.');
    if (player.hp >= player.maxHp) return fail('You are already at full health.');
    p.tonics -= 1;
    player.cooldowns.set('tonic', TONIC.cooldown);
    player.touchProgress();
    this.heal(player, tonicHeal(player.level) * (1 + activePetBonus(player.progress, 'tonicHeal')));
    return ok();
  }

  // ------------------------------------------------------------------ helpers

  private heal(player: Player, amount: number): void {
    if (player.dead) return;
    const before = player.hp;
    player.hp = Math.min(player.maxHp, player.hp + Math.round(amount));
    const amt = Math.round(player.hp - before);
    if (amt > 0) this.events.area(player.body.x, player.body.z, { e: 'heal', id: player.id, amt });
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
    const onKill = killer.passive.onKill ?? 0;
    if (onKill > 0 && !killer.dead) this.heal(killer, killer.maxHp * onKill);
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

  /** Can this hero heal or buff that one? Not across a duel, and not into another rift party. */
  private canHelp(helper: Player, other: Player): boolean {
    if (this.world.duelOpponent(helper) || this.world.duelOpponent(other)) return false;
    return helper.party === other.party;
  }

  private foesAround(player: Player, radius: number): Foe[] {
    const opponent = this.world.duelOpponent(player);
    if (opponent) {
      return this.gap(player, opponent.body.x, opponent.body.y, opponent.body.z, HERO_RADIUS) <= radius ? [{ kind: 'hero', p: opponent }] : [];
    }
    const foes: Foe[] = [];
    for (const m of this.world.monstersNear(player.body.x, player.body.z, radius + 3)) {
      if (!m.alive || !sameFight(m, player.party) || Math.abs(m.y - player.body.y) > AREA_VERTICAL || this.reach(player, m) > radius) continue;
      foes.push({ kind: 'monster', m });
    }
    return foes;
  }

  private alliesAround(player: Player, radius: number): Player[] {
    const allies = [player];
    for (const p of this.world.playersNear(player.body.x, player.body.z, radius)) {
      if (p === player || p.dead || Math.abs(p.body.y - player.body.y) > AREA_VERTICAL || !this.canHelp(player, p)) continue;
      if (Math.hypot(p.body.x - player.body.x, p.body.z - player.body.z) <= radius) allies.push(p);
    }
    return allies;
  }

  /** The target, plus everything within the skill's splash radius of it. */
  private withSplash(caster: Player, def: SkillDef, target: Monster): Foe[] {
    const foes: Foe[] = [{ kind: 'monster', m: target }];
    if (def.radius <= 0) return foes;
    for (const m of this.world.monstersNear(target.x, target.z, def.radius + 3)) {
      if (m === target || !m.alive || !sameFight(m, caster.party) || Math.abs(m.y - target.y) > AREA_VERTICAL) continue;
      if (Math.hypot(m.x - target.x, m.z - target.z) - m.bodyRadius <= def.radius) foes.push({ kind: 'monster', m });
    }
    return foes;
  }

  /** Gap between the hero and a body's edge, or infinity if too far up or down. */
  private gap(player: Player, x: number, y: number, z: number, radius: number): number {
    if (Math.abs(y - player.body.y) > VERTICAL_REACH) return Number.POSITIVE_INFINITY;
    return Math.hypot(x - player.body.x, z - player.body.z) - radius;
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
}
