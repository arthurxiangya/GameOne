import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import {
  CLASSES,
  CLASS_IDS,
  CRIT_CHANCE,
  CRIT_MULTIPLIER,
  Mulberry32,
  SPEC_LEVEL,
  type ClassId,
  type SpecId,
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
}

const builds = (): Build[] =>
  CLASS_IDS.flatMap((cls) => [
    { cls, spec: null, label: CLASSES[cls].name },
    ...CLASSES[cls].specs.map((s) => ({ cls, spec: s.id, label: `${CLASSES[cls].name} · ${s.name}` })),
  ]);

function hero(world: GameWorld, build: Build, level: number): Player {
  const p = spawnHero(world, build.label.slice(0, 12), level, build.cls);
  if (build.spec) p.progress.specs[build.cls] = build.spec;
  p.restoreVitals();
  return p;
}

/** Plays one step of the class rotation: the first skill that is ready, affordable and wanted. */
function act(world: GameWorld, p: Player, foes: readonly Monster[]): void {
  const alive = foes.filter((m) => m.alive);
  if (alive.length === 0) return;
  const target = alive.reduce((a, b) => (Math.hypot(a.x - p.body.x, a.z - p.body.z) <= Math.hypot(b.x - p.body.x, b.z - p.body.z) ? a : b));
  const near = alive.filter((m) => Math.hypot(m.x - p.body.x, m.z - p.body.z) < 6).length;
  for (const step of p.classDef.rotation) {
    if (step.when === 'hurt' && p.hp >= p.maxHp * 0.7) continue;
    if (step.when === 'pack' && near < 2) continue;
    const def = p.kit.find((s) => s.id === step.skill);
    if (!def || p.level < def.unlockLevel || p.cooldown(def.id) > 0 || p.mp < def.cost) continue;
    const target_ = def.target === 'ally' ? p.id : target.id;
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
  const world = makeWorld(new Mulberry32(13));
  const p = hero(world, build, level);
  const at = place(p);
  const foes = Array.from({ length: 3 }, (_, i) => {
    const a = (i / 3) * Math.PI * 2;
    return world.spawnMonster('boar', level, at.x + Math.cos(a) * 2.4, at.z + Math.sin(a) * 2.4, { huntRange: 12, maxHp: 1e9 });
  });
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
