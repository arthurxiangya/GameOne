import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { CLASSES, CLASS_IDS, SPEC_LEVEL, TALENTS, type ClassId, type TalentDef } from '@lanternwood/shared';
import { CAP, CRIT_AVERAGE, MEASURES, builds, endurance, measure, pack, singleTarget, type Build, type Measures, type PackResult } from './balance-harness';

/**
 * The balance guardrail for classes, specs and talents: every build plays its rotation through
 * the real server code (see balance-harness.ts) and must land inside the design's bands.
 */

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
