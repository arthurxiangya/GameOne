import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import {
  CLASSES,
  CLASS_IDS,
  GEAR_SLOTS,
  LEGENDARIES,
  LEGENDARY_IDS,
  affixCount,
  heroStats,
  type AffixStat,
  type ClassId,
  type Equipped,
  type GearSlot,
  type Item,
  type LegendaryDef,
  type SetId,
} from '@lanternwood/shared';
import { GEAR_CAP, GEAR_MEASURES, absolute, measure, powerOf, singleTarget, type Build, type Measures } from './balance-harness';

/**
 * Gear's guardrail, measured through the real server like the class and talent bands:
 * affixes add about a third at most and mixing beats stacking, a set is a different build
 * rather than a better one, and a legendary stays inside the talent caps.
 */

const LEVEL = 20;
let ids = 1;
const piece = (slot: GearSlot, affixes: readonly AffixStat[], o: Partial<Item> = {}): Item => ({
  id: ids++, slot, rarity: 'epic', ilvl: 100, tier: 0, affixes, reforged: -1, set: null, legendary: null, ...o,
});

/** iLvl `ilvl` epics in all six slots, with these 19 affixes dealt out in slot order (none for main lines only). */
function outfit(stats: readonly AffixStat[] | null, ilvl = 100): Equipped {
  const gear: Partial<Record<GearSlot, Item>> = {};
  let n = 0;
  for (const slot of GEAR_SLOTS) {
    const count = affixCount(slot, 'epic', null);
    gear[slot] = piece(slot, stats ? stats.slice(n, n + count) : [], { ilvl });
    n += count;
  }
  return gear;
}

const repeat = (stat: AffixStat, n: number): AffixStat[] => Array.from({ length: n }, () => stat);
const ALL_POWER = repeat('power', 19);
const MIX: AffixStat[] = Array.from({ length: 19 }, (_, i) => (['power', 'crit', 'haste'] as const)[i % 3]);
const SURVIVAL: AffixStat[] = Array.from({ length: 19 }, (_, i) => (i % 3 === 0 ? 'power' : 'vigor'));

/** Damage per second on one dummy for 60 s. */
const dps = (cls: ClassId, gear: Equipped): number => {
  const build: Build = { cls, spec: null, label: CLASSES[cls].name, gear };
  return singleTarget(build, LEVEL, 60) * powerOf(build, LEVEL);
};

const report: string[] = [];
after(() => console.log(report.join('\n')));

describe('gear balance (level 20, iLvl 100 epics in every slot)', () => {
  const rows = CLASS_IDS.map((cls) => {
    const plain = dps(cls, outfit(null));
    return { cls, plain, power: dps(cls, outfit(ALL_POWER)) / plain, mix: dps(cls, outfit(MIX)) / plain };
  });
  report.push('Class | all Power | even mix', ...rows.map((r) => `${CLASSES[r.cls].name} | ×${r.power.toFixed(3)} | ×${r.mix.toFixed(3)}`));

  it('stacking Power adds about 23% for every class', () => {
    for (const r of rows) assert.ok(r.power > 1.18 && r.power < 1.28, `${r.cls}: ×${r.power.toFixed(3)}`);
  });

  it('an even mix adds at most about a third, and beats stacking Power for every class', () => {
    for (const r of rows) {
      assert.ok(r.mix > 1.22 && r.mix < 1.42, `${r.cls}: ×${r.mix.toFixed(3)}`);
      assert.ok(r.mix > r.power, `${r.cls}: the mix (×${r.mix.toFixed(3)}) should beat all Power (×${r.power.toFixed(3)})`);
    }
  });

  it('a survival mix trades output for about a fifth more health', () => {
    for (const cls of CLASS_IDS) {
      const stats = (gear: Equipped) => heroStats({ cls, specs: {}, talents: {}, gear }, LEVEL);
      const health = stats(outfit(SURVIVAL)).maxHp / stats(outfit(null)).maxHp;
      assert.ok(health > 1.17 && health < 1.25, `${cls}: health ×${health.toFixed(3)}`);
    }
  });
});

const change = (m: Measures, base: Measures): number[] => GEAR_MEASURES.map((k) => m[k] / base[k] - 1);
const fmt = (c: readonly number[]) => c.map((x) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}%`).join(' | ');

describe('legendary balance (level 20, its own spec, against a plain item in the same slot)', () => {
  const owner = (l: LegendaryDef): ClassId => CLASS_IDS.find((c) => CLASSES[c].specs.some((s) => s.id === l.spec))!;
  const results = LEGENDARY_IDS.map((id) => {
    const l = LEGENDARIES[id];
    const cls = owner(l);
    const base: Build = { cls, spec: l.spec, label: l.name, gear: { [l.slot]: piece(l.slot, [], { rarity: 'common' }) } };
    const worn: Build = { ...base, gear: { [l.slot]: piece(l.slot, [], { rarity: 'legendary', legendary: id }) } };
    return { l, change: change(measure(worn, LEVEL), measure(base, LEVEL)) };
  });
  report.push('Legendary | single | pack | lasts | fight | ally damage | ally lasts | hold', ...results.map((r) => `${r.l.name} | ${fmt(r.change)}`));

  it('no legendary adds more than a talent may: 15% to a damage measure, 25% to survival', () => {
    for (const { l, change: c } of results) GEAR_MEASURES.forEach((k, i) => assert.ok(c[i]! <= GEAR_CAP[k] + 1e-9, `${l.name}: ${k} +${(c[i]! * 100).toFixed(1)}%`));
  });

  it('every legendary changes something you can measure', () => {
    for (const { l, change: c } of results) assert.ok(c.some((x) => x >= 0.02), `${l.name}: ${fmt(c)}`);
  });
});

describe('set balance (level 20, four set pieces against four plain epics with one more affix each)', () => {
  const cases: readonly { readonly set: SetId; readonly cls: ClassId }[] = [
    { set: 'frostward', cls: 'warden' },
    { set: 'emberfall', cls: 'emberblade' },
    // A Warden uses Ground Slam, its fourth skill, on cooldown, so its partner shows the song.
    { set: 'bellsong', cls: 'warden' },
  ];
  const armour = ['helm', 'chest', 'gloves', 'boots'] as const;
  const results = cases.map(({ set, cls }) => {
    const plain: Build = { cls, spec: null, label: `${cls} plain`, gear: Object.fromEntries(armour.map((s) => [s, piece(s, ['power', 'crit', 'haste'])])) };
    const worn: Build = { cls, spec: null, label: `${cls} ${set}`, gear: Object.fromEntries(armour.map((s) => [s, piece(s, ['power', 'crit'], { set })])) };
    return { set, change: change(absolute(measure(worn, LEVEL)), absolute(measure(plain, LEVEL))) };
  });
  report.push('Set vs plain | single | pack | lasts | fight | ally damage | ally lasts | hold', ...results.map((r) => `${r.set} | ${fmt(r.change)}`));

  it('a set is a different build, not a better one: it never wins at everything, and always wins at something', () => {
    for (const { set, change: c } of results) {
      assert.ok(!c.every((x) => x > 0.02), `${set} beats plain epics at everything: ${fmt(c)}`);
      assert.ok(c.some((x) => x > 0.02), `${set} is worse than plain epics at everything: ${fmt(c)}`);
    }
  });

  it('a set never adds more than a talent may to any measure', () => {
    for (const { set, change: c } of results) GEAR_MEASURES.forEach((k, i) => assert.ok(c[i]! <= GEAR_CAP[k] + 1e-9, `${set}: ${k} +${(c[i]! * 100).toFixed(1)}%`));
  });
});
