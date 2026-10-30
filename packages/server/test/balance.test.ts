import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import {
  CLASSES,
  CLASS_IDS,
  CRIT_CHANCE,
  CRIT_MULTIPLIER,
  Mulberry32,
  SPEC_LEVEL,
  TALENTS,
  TALENT_LEVELS,
  type ClassId,
  type SpecId,
  type TalentDef,
} from '@lanternwood/shared';
import type { GameWorld } from '../src/application/game-world';
import type { Monster } from '../src/domain/entities/monster';
import type { Player } from '../src/domain/entities/player';
import { makeWorld, spawnHero } from './support';

/**
 * The balance guardrail. Every class and spec plays its configured rotation through the real
 * server code, and the results must stay inside the design's bands. A change that makes one
 * build better than the rest at everything fails here, before it ships.
 */

const DT = 0.05;
/** Crits add this much on average. */
const CRIT_AVERAGE = 1 + CRIT_CHANCE * (CRIT_MULTIPLIER - 1);

interface Build {
  readonly cls: ClassId;
  readonly spec: SpecId | null;
  readonly label: string;
  /** One talent to try, in its own row. */
  readonly talent?: { readonly row: number; readonly def: TalentDef };
}

const builds = (): Build[] =>
  CLASS_IDS.flatMap((cls) => [
    { cls, spec: null, label: CLASSES[cls].name },
    ...CLASSES[cls].specs.map((s) => ({ cls, spec: s.id, label: `${CLASSES[cls].name} · ${s.name}` })),
  ]);

function hero(world: GameWorld, build: Build, level: number): Player {
  const p = spawnHero(world, build.label.slice(0, 12), level, build.cls);
  if (build.spec) p.progress.specs[build.cls] = build.spec;
  if (build.talent) p.progress.talents[build.cls] = TALENT_LEVELS.map((_, row) => (row === build.talent!.row ? build.talent!.def.id : null));
  p.restoreVitals();
  return p;
}

/**
 * Plays one step of the class rotation: the first skill that is ready, affordable and wanted.
 * With an ally, heals and wards go to whichever of the two is hurt worse.
 */
function act(world: GameWorld, p: Player, foes: readonly Monster[], ally?: Player): void {
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

function place(p: Player): { x: number; z: number } {
  // The town plaza: flat, and far from every monster spawn.
  Object.assign(p.body, { x: 0, z: 12, vx: 0, vy: 0, vz: 0 });
  return { x: 0, z: 12 };
}

/** Sustained single-target output in Power per second against a dummy that never dies. */
function singleTarget(build: Build, level: number, seconds = 90): number {
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

interface PackResult {
  readonly won: boolean;
  readonly seconds: number;
  /** Health left at the end, as a share of max. */
  readonly health: number;
}

/** Stand still and fight `count` same-level boars at once, no tonics. */
function pack(build: Build, level: number, count: number, seed = 11): PackResult {
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
function endurance(build: Build, level: number, cap = 120): number {
  return (enduranceOnce(build, level, cap, 13) + enduranceOnce(build, level, cap, 29)) / 2;
}

/** Spreads the monsters' first swings over one attack interval, so hits don't land in lockstep. */
function desync(foes: readonly Monster[], seed: number): void {
  const rng = new Mulberry32(seed);
  for (const m of foes) m.attackCooldown = rng.next() * m.def.attackInterval;
}

function enduranceOnce(build: Build, level: number, cap: number, seed: number): number {
  const world = makeWorld(new Mulberry32(seed));
  const p = hero(world, build, level);
  const at = place(p);
  const foes = Array.from({ length: 3 }, (_, i) => {
    const a = (i / 3) * Math.PI * 2;
    return world.spawnMonster('boar', level, at.x + Math.cos(a) * 2.4, at.z + Math.sin(a) * 2.4, { huntRange: 12, maxHp: 1e9 });
  });
  desync(foes, seed);
  let t = 0;
  while (t < cap && !p.dead) {
    act(world, p, foes);
    world.step(DT);
    world.drainEvents();
    t += DT;
  }
  return t;
}

const rows: string[] = [];

describe('class balance (measured through the real server)', () => {
  const level = SPEC_LEVEL;
  const results = new Map<string, { dps: number; lasts: number; two: PackResult; three: PackResult }>();
  const all = builds();
  for (const b of all) {
    results.set(b.label, { dps: singleTarget(b, level), lasts: endurance(b, level), two: pack(b, level, 2), three: pack(b, level, 3) });
  }

  after(() => {
    // Printed for the design doc: `npx tsx --test packages/server/test/balance.test.ts`.
    console.log(['Build | P/s | lasts vs 3 | 2 boars | 3 boars', ...rows].join('\n'));
  });

  it('every class base kit hits its designed output, within 15%', () => {
    for (const cls of CLASS_IDS) {
      const r = results.get(CLASSES[cls].name)!;
      const designed = CLASSES[cls].targetOutput * CRIT_AVERAGE;
      assert.ok(r.dps > designed * 0.85 && r.dps < designed * 1.15, `${cls}: measured ${r.dps.toFixed(2)} P/s, designed ${designed.toFixed(2)}`);
    }
    for (const b of all) {
      const r = results.get(b.label)!;
      const fmt = (x: PackResult) => (x.won ? `won in ${x.seconds.toFixed(1)} s, ${Math.round(x.health * 100)}% left` : `lost at ${x.seconds.toFixed(1)} s`);
      rows.push(`${b.label} | ${r.dps.toFixed(2)} | ${r.lasts >= 120 ? '120+' : r.lasts.toFixed(1)} s | ${fmt(r.two)} | ${fmt(r.three)}`);
    }
  });

  it('a spec never makes a hero weaker, and never more than 30% stronger on one target', () => {
    for (const b of all.filter((x) => x.spec)) {
      const base = results.get(CLASSES[b.cls].name)!.dps;
      const dps = results.get(b.label)!.dps;
      assert.ok(dps >= base * 0.95 && dps <= base * 1.3, `${b.label}: ${dps.toFixed(2)} vs base ${base.toFixed(2)}`);
    }
  });

  it('every build beats two same-level monsters standing still with no tonics', () => {
    for (const b of all) assert.ok(results.get(b.label)!.two.won, `${b.label} lost to two boars`);
  });

  it('the tank and the healer hold three at once', () => {
    for (const b of all.filter((x) => x.cls === 'warden' || x.cls === 'lightkeeper')) {
      assert.ok(results.get(b.label)!.three.won, `${b.label} lost to three boars`);
    }
  });

  it('no build is the best at both damage and survival', () => {
    const list = all.map((b) => ({ label: b.label, ...results.get(b.label)! }));
    const sturdy = (x: (typeof list)[number]) => x.lasts;
    const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
    const topDamage = list.reduce((a, b) => (a.dps >= b.dps ? a : b));
    const topSurvival = list.reduce((a, b) => (sturdy(a) >= sturdy(b) ? a : b));
    assert.ok(sturdy(topDamage) <= median(list.map(sturdy)), `${topDamage.label} has the most damage and above-median survival`);
    assert.ok(topSurvival.dps <= median(list.map((x) => x.dps)), `${topSurvival.label} is the sturdiest and has above-median damage`);
  });

  it('each class’s two specs are a trade-off: neither is better at both damage and survival', () => {
    for (const cls of CLASS_IDS) {
      const [a, b] = CLASSES[cls].specs.map((s) => results.get(`${CLASSES[cls].name} · ${s.name}`)!);
      const better = (x: typeof a, y: typeof a) => x!.dps > y!.dps * 1.03 && x!.lasts > y!.lasts * 1.03;
      assert.ok(!better(a, b) && !better(b, a), `${cls}: one spec wins at everything`);
    }
  });

  it('kills a same-level monster in 1.5–7 s at levels 5, 10 and 20', () => {
    for (const cls of CLASS_IDS) {
      for (const lvl of [5, 10, 20]) {
        const r = pack({ cls, spec: null, label: cls }, lvl, 1, 5);
        assert.ok(r.won && r.seconds >= 1.5 && r.seconds <= 7, `${cls} at level ${lvl}: ${r.won ? `${r.seconds.toFixed(1)} s` : 'lost'}`);
      }
    }
  });
});

/** Area output: Power per second against three dummies standing together. */
function packOutput(build: Build, level: number, seconds = 40): number {
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

interface Measures {
  readonly single: number;
  readonly pack: number;
  readonly lasts: number;
  /** Beating three real boars: 1 + health left if won, else the share of three minutes survived. */
  readonly fight: number;
  /** What a partner Emberblade adds on the same target (the duo's output minus the hero's own). */
  readonly allyDamage: number;
  /** How long a partner Emberblade lasts against three boars that only hit them, with the hero helping. */
  readonly allyLasts: number;
}

const MEASURES = ['single', 'pack', 'lasts', 'fight', 'allyDamage', 'allyLasts'] as const;
type MeasureKey = (typeof MEASURES)[number];
/** A talent may add at most this much to a damage measure, or to a survival measure. */
const CAP: Readonly<Record<MeasureKey, number>> = { single: 0.15, pack: 0.15, allyDamage: 0.15, lasts: 0.25, fight: 0.25, allyLasts: 0.25 };

function partner(world: GameWorld, level: number, x: number, z: number): Player {
  const ally = spawnHero(world, 'Partner', level, 'emberblade');
  Object.assign(ally.body, { x, z, vx: 0, vy: 0, vz: 0 });
  return ally;
}

/** Duo output on one dummy, in the hero's Power per second, minus what the hero does alone. */
function allyDamage(build: Build, level: number, alone: number, seconds = 40): number {
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

function allyLasts(build: Build, level: number, cap = 90): number {
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

function measure(build: Build, level: number): Measures {
  const f = pack(build, level, 3);
  const single = singleTarget(build, level, 60);
  return {
    single,
    pack: packOutput(build, level),
    lasts: endurance(build, level),
    fight: f.won ? 1 + f.health : f.seconds / 180,
    allyDamage: allyDamage(build, level, single),
    allyLasts: allyLasts(build, level),
  };
}

const talentRows: string[] = [];

describe('talent balance (level 20, base kits, one talent at a time)', () => {
  const level = 20;
  const results = new Map<ClassId, { base: Measures; rows: { def: TalentDef; m: Measures }[][] }>();
  for (const cls of CLASS_IDS) {
    const base: Build = { cls, spec: null, label: CLASSES[cls].name };
    results.set(cls, {
      base: measure(base, level),
      rows: TALENTS[cls].map((options, row) => options.map((def) => ({ def, m: measure({ ...base, talent: { row, def } }, level) }))),
    });
  }

  after(() => {
    console.log(['Class | Talent | single | pack | lasts | fight | ally damage | ally lasts (vs no talent)', ...talentRows].join('\n'));
  });

  const changes = [...results].flatMap(([cls, r]) =>
    r.rows.flat().map(({ def, m }) => ({ cls, def, change: MEASURES.map((k) => m[k] / r.base[k] - 1) })),
  );
  for (const { cls, def, change } of changes) {
    talentRows.push(`${CLASSES[cls].name} | ${def.name} | ${change.map((c) => `${c >= 0 ? '+' : ''}${(c * 100).toFixed(1)}%`).join(' | ')}`);
  }

  it('no talent adds more than 15% to a damage measure or 25% to a survival measure', () => {
    for (const { def, change } of changes) {
      MEASURES.forEach((k, i) => assert.ok(change[i]! <= CAP[k] + 1e-9, `${def.name}: ${k} +${(change[i]! * 100).toFixed(1)}%`));
    }
  });

  it('within a row, every choice is worth at least 40% of the best one', () => {
    // A choice's worth is its biggest gain as a share of that measure's cap.
    const worth = (change: number[]) => Math.max(...MEASURES.map((k, i) => change[i]! / CAP[k]));
    for (const [cls, r] of results) {
      r.rows.forEach((options, row) => {
        const worths = options.map(({ def }) => ({ def, w: worth(changes.find((c) => c.def === def)!.change) }));
        const best = Math.max(...worths.map((x) => x.w));
        for (const { def, w } of worths) assert.ok(w >= best * 0.4, `${cls} row ${row + 1}: ${def.name} is worth ${(w * 100).toFixed(0)}% of a cap, the best ${(best * 100).toFixed(0)}%`);
      });
    }
  });

  it('every talent does something you can measure', () => {
    for (const { def, change } of changes) assert.ok(change.some((c) => c >= 0.02), `${def.name} changes nothing by 2% or more`);
  });

  it('no talent in a row beats another of the same row at every measure', () => {
    for (const [cls, r] of results) {
      for (const row of r.rows) {
        for (const a of row) {
          for (const b of row) {
            if (a === b) continue;
            const wins = MEASURES.every((k) => a.m[k] > b.m[k] * 1.02 || (k === 'allyDamage' && a.m[k] > b.m[k] + 0.02));
            assert.ok(!wins, `${cls}: ${a.def.name} beats ${b.def.name} at everything`);
          }
        }
      }
    }
  });
});
