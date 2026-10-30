import {
  CLASSES,
  CLASS_IDS,
  CRIT_CHANCE,
  CRIT_MULTIPLIER,
  Mulberry32,
  TALENT_LEVELS,
  heroStats,
  type ClassId,
  type Equipped,
  type SpecId,
  type TalentDef,
} from '@lanternwood/shared';
import type { GameWorld } from '../src/application/game-world';
import type { Monster } from '../src/domain/entities/monster';
import type { Player } from '../src/domain/entities/player';
import { makeWorld, spawnHero } from './support';

/**
 * The balance harness: heroes play their class rotation through the real server code, and these
 * measures say how they did. The balance tests (classes, talents, gear) hold the results to the
 * design's bands, so a change that makes one build better than the rest at everything fails
 * before it ships.
 */

export const DT = 0.05;
/** Crits add this much on average. */
export const CRIT_AVERAGE = 1 + CRIT_CHANCE * (CRIT_MULTIPLIER - 1);

export interface Build {
  readonly cls: ClassId;
  readonly spec: SpecId | null;
  readonly label: string;
  /** One talent to try, in its own row. */
  readonly talent?: { readonly row: number; readonly def: TalentDef };
  /** What the hero wears (nothing by default). */
  readonly gear?: Equipped;
}

export const builds = (): Build[] =>
  CLASS_IDS.flatMap((cls) => [
    { cls, spec: null, label: CLASSES[cls].name },
    ...CLASSES[cls].specs.map((s) => ({ cls, spec: s.id, label: `${CLASSES[cls].name} · ${s.name}` })),
  ]);

export function hero(world: GameWorld, build: Build, level: number): Player {
  const p = spawnHero(world, build.label.slice(0, 12), level, build.cls);
  if (build.spec) p.progress.specs[build.cls] = build.spec;
  if (build.talent) p.progress.talents[build.cls] = TALENT_LEVELS.map((_, row) => (row === build.talent!.row ? build.talent!.def.id : null));
  if (build.gear) p.progress.gear = build.gear;
  p.restoreVitals();
  return p;
}

/**
 * Plays one step of the class rotation: the first skill that is ready, affordable and wanted.
 * With an ally, heals and wards go to whichever of the two is hurt worse.
 */
export function act(world: GameWorld, p: Player, foes: readonly Monster[], ally?: Player): void {
  if (p.dead) return;
  const alive = foes.filter((m) => m.alive);
  if (alive.length === 0) return;
  const target = alive.reduce((a, b) => (Math.hypot(a.x - p.body.x, a.z - p.body.z) <= Math.hypot(b.x - p.body.x, b.z - p.body.z) ? a : b));
  const near = alive.filter((m) => Math.hypot(m.x - p.body.x, m.z - p.body.z) < 6).length;
  const share = (h: Player) => h.hp / h.maxHp;
  const patient = ally && !ally.dead && share(ally) < share(p) ? ally : p;
  for (const step of p.classDef.rotation) {
    if (step.when === 'hurt' && share(patient) >= 0.7) continue;
    if (step.when === 'pack' && near < 2) continue;
    const def = p.kit.find((s) => s.id === step.skill);
    if (!def || p.level < def.unlockLevel || p.cooldown(def.id) > 0 || p.mp < def.cost) continue;
    const target_ = def.target === 'ally' ? patient.id : target.id;
    if (world.execute(p.id, { kind: 'skill', skill: def.id, target: target_ }).ok) return;
  }
}

export function place(p: Player): { x: number; z: number } {
  // The town plaza: flat, and far from every monster spawn.
  Object.assign(p.body, { x: 0, z: 12, vx: 0, vy: 0, vz: 0 });
  return { x: 0, z: 12 };
}

/** Sustained single-target output in Power per second against a dummy that never dies. */
export function singleTarget(build: Build, level: number, seconds = 90): number {
  const world = makeWorld(new Mulberry32(7));
  const p = hero(world, build, level);
  const at = place(p);
  // The dummy hits for 1 so Resolve still builds the way it does in a real fight.
  const dummy = world.spawnMonster('golem', level, at.x + 2.2, at.z, { maxHp: 1e9, damage: 0, slamDamage: 0 });
  for (let t = 0; t < seconds; t += DT) {
    act(world, p, [dummy]);
    world.step(DT);
    world.drainEvents();
  }
  return (dummy.maxHp - dummy.hp) / seconds / p.attack;
}

export interface PackResult {
  readonly won: boolean;
  readonly seconds: number;
  /** Health left at the end, as a share of max. */
  readonly health: number;
}

/** Stand still and fight `count` same-level boars at once, no tonics. */
export function pack(build: Build, level: number, count: number, seed = 11): PackResult {
  const world = makeWorld(new Mulberry32(seed));
  const p = hero(world, build, level);
  const at = place(p);
  const foes = Array.from({ length: count }, (_, i) => {
    const a = (i / count) * Math.PI * 2;
    return world.spawnMonster('boar', level, at.x + Math.cos(a) * 2.4, at.z + Math.sin(a) * 2.4, { huntRange: 12 });
  });
  let t = 0;
  while (t < 180 && !p.dead && foes.some((m) => m.alive)) {
    act(world, p, foes);
    world.step(DT);
    world.drainEvents();
    t += DT;
  }
  return { won: !p.dead && !foes.some((m) => m.alive), seconds: t, health: p.dead ? 0 : p.hp / p.maxHp };
}

/**
 * Defence on its own: how long the hero lasts against three same-level boars that never die,
 * fighting back with its rotation (heals, shields and leech all count). Capped at two minutes.
 */
export function endurance(build: Build, level: number, cap = 120): number {
  return holding(build, level, cap).lasts;
}

/** Endurance, plus the damage dealt meanwhile in Power per second (reflected blows count). */
export function holding(build: Build, level: number, cap = 120): { readonly lasts: number; readonly hold: number } {
  const runs = [13, 29].map((seed) => enduranceOnce(build, level, cap, seed));
  return { lasts: (runs[0]!.t + runs[1]!.t) / 2, hold: (runs[0]!.output + runs[1]!.output) / 2 };
}

/** Spreads the monsters' first swings over one attack interval, so hits don't land in lockstep. */
export function desync(foes: readonly Monster[], seed: number): void {
  const rng = new Mulberry32(seed);
  for (const m of foes) m.attackCooldown = rng.next() * m.def.attackInterval;
}

function enduranceOnce(build: Build, level: number, cap: number, seed: number): { t: number; output: number } {
  const world = makeWorld(new Mulberry32(seed));
  const p = hero(world, build, level);
  const at = place(p);
  const foes = Array.from({ length: 3 }, (_, i) => {
    const a = (i / 3) * Math.PI * 2;
    return world.spawnMonster('boar', level, at.x + Math.cos(a) * 2.4, at.z + Math.sin(a) * 2.4, { huntRange: 12, maxHp: 1e9 });
  });
  desync(foes, seed);
  // Counted from damage events: a boar that loses its target walks home and heals, which would hide damage.
  const ids = new Set(foes.map((m) => m.id));
  let dealt = 0;
  let t = 0;
  while (t < cap && !p.dead) {
    act(world, p, foes);
    world.step(DT);
    for (const r of world.drainEvents()) if (r.event.e === 'dmg' && ids.has(r.event.id)) dealt += r.event.amt;
    t += DT;
  }
  return { t, output: dealt / t / p.attack };
}

/** Area output: Power per second against three dummies standing together. */
export function packOutput(build: Build, level: number, seconds = 40): number {
  const world = makeWorld(new Mulberry32(17));
  const p = hero(world, build, level);
  const at = place(p);
  const dummies = Array.from({ length: 3 }, (_, i) => {
    const a = (i / 3) * Math.PI * 2;
    return world.spawnMonster('golem', level, at.x + 2.2 + Math.cos(a) * 1.2, at.z + Math.sin(a) * 1.2, { maxHp: 1e9, damage: 0, slamDamage: 0 });
  });
  for (let t = 0; t < seconds; t += DT) {
    act(world, p, dummies);
    world.step(DT);
    world.drainEvents();
  }
  return dummies.reduce((sum, d) => sum + d.maxHp - d.hp, 0) / seconds / p.attack;
}

export interface Measures {
  readonly single: number;
  readonly pack: number;
  readonly lasts: number;
  /** Beating three real boars: 1 + health left if won, else the share of three minutes survived. */
  readonly fight: number;
  /** What a partner Emberblade adds on the same target (the duo's output minus the hero's own). */
  readonly allyDamage: number;
  /** How long a partner Emberblade lasts against three boars that only hit them, with the hero helping. */
  readonly allyLasts: number;
  /** Output while holding three boars that hit back, in Power per second (reflected blows count). Gear bands only. */
  readonly hold: number;
  /** The hero's Power: damage measures are in Power per second, so gear comparisons multiply back. */
  readonly power: number;
}

export const MEASURES = ['single', 'pack', 'lasts', 'fight', 'allyDamage', 'allyLasts'] as const;
export type MeasureKey = (typeof MEASURES)[number];
/** A talent may add at most this much to a damage measure, or to a survival measure. */
export const CAP: Readonly<Record<MeasureKey, number>> = { single: 0.15, pack: 0.15, allyDamage: 0.15, lasts: 0.25, fight: 0.25, allyLasts: 0.25 };

export function partner(world: GameWorld, level: number, x: number, z: number): Player {
  const ally = spawnHero(world, 'Partner', level, 'emberblade');
  Object.assign(ally.body, { x, z, vx: 0, vy: 0, vz: 0 });
  return ally;
}

/** Duo output on one dummy, in the hero's Power per second, minus what the hero does alone. */
export function allyDamage(build: Build, level: number, alone: number, seconds = 40): number {
  const world = makeWorld(new Mulberry32(19));
  const p = hero(world, build, level);
  const at = place(p);
  const dummy = world.spawnMonster('golem', level, at.x + 2.2, at.z, { maxHp: 1e9, damage: 0, slamDamage: 0 });
  const ally = partner(world, level, at.x + 4.4, at.z);
  for (let t = 0; t < seconds; t += DT) {
    act(world, p, [dummy], ally);
    act(world, ally, [dummy]);
    world.step(DT);
    world.drainEvents();
  }
  return (dummy.maxHp - dummy.hp) / seconds / p.attack - alone;
}

export function allyLasts(build: Build, level: number, cap = 90): number {
  const runs = [23, 31].map((seed) => {
    const world = makeWorld(new Mulberry32(seed));
    const p = hero(world, build, level);
    const at = place(p);
    const ally = partner(world, level, at.x + 4, at.z);
    const foes = Array.from({ length: 3 }, (_, i) => {
      const a = (i / 3) * Math.PI * 2;
      return world.spawnMonster('boar', level, ally.body.x + Math.cos(a) * 2.4, ally.body.z + Math.sin(a) * 2.4, { maxHp: 1e9 });
    });
    desync(foes, seed);
    let t = 0;
    while (t < cap && !ally.dead) {
      for (const m of foes) m.taunt(ally.id, world.time + 1);
      act(world, p, foes, ally);
      act(world, ally, foes);
      world.step(DT);
      world.drainEvents();
      t += DT;
    }
    return t;
  });
  return runs.reduce((a, b) => a + b, 0) / runs.length;
}

export function measure(build: Build, level: number): Measures {
  const f = pack(build, level, 3);
  const single = singleTarget(build, level, 60);
  return {
    single,
    pack: packOutput(build, level),
    ...holding(build, level),
    fight: f.won ? 1 + f.health : f.seconds / 180,
    allyDamage: allyDamage(build, level, single),
    allyLasts: allyLasts(build, level),
    power: powerOf(build, level),
  };
}

/** The hero's Power with this build's gear, as the server works it out. */
export function powerOf(build: Build, level: number): number {
  const specs = build.spec ? { [build.cls]: build.spec } : {};
  return heroStats({ cls: build.cls, specs, talents: {}, gear: build.gear ?? {} }, level).power;
}

/** The damage measures in damage per second rather than Power per second, for comparing gear. */
export const absolute = (m: Measures): Measures => ({
  ...m, single: m.single * m.power, pack: m.pack * m.power, allyDamage: m.allyDamage * m.power, hold: m.hold * m.power,
});

/** Gear is held to the talent measures plus `hold`, where a reflecting tank shows up. */
export const GEAR_MEASURES = [...MEASURES, 'hold'] as const;
export type GearMeasureKey = (typeof GEAR_MEASURES)[number];
export const GEAR_CAP: Readonly<Record<GearMeasureKey, number>> = { ...CAP, hold: 0.15 };

