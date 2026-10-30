import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  AFFIXES,
  AFFIX_STATS,
  ARMOUR_SLOTS,
  CLASSES,
  CLASS_IDS,
  CRIT_CHANCE,
  CRIT_MULTIPLIER,
  GEAR_SLOTS,
  LEGACY_ILVL_PER_TIER,
  LEGENDARIES,
  LEGENDARY_IDS,
  Mulberry32,
  RARITY,
  affixBonus,
  affixCount,
  basePower,
  canWear,
  dropIlvl,
  gearStats,
  heroStats,
  itemName,
  maxHpFor,
  parseClientMessage,
  rollItem,
  upgradeCeiling,
  type AffixStat,
  type Equipped,
  type GearSlot,
  type Item,
} from '../src/index';

let ids = 1;
const item = (slot: GearSlot, affixes: AffixStat[], o: Partial<Item> = {}): Item => ({
  id: ids++, slot, rarity: 'epic', ilvl: 100, tier: 0, affixes, reforged: -1, set: null, legendary: null, ...o,
});

/** A full set of iLvl `ilvl` epics: 3 affixes per slot and 4 on the charm, 19 in all, dealt out in order. */
function fullSet(stats: readonly AffixStat[], ilvl = 100): Equipped {
  assert.equal(stats.length, 19);
  const gear: Partial<Record<GearSlot, Item>> = {};
  let n = 0;
  for (const slot of GEAR_SLOTS) {
    const count = affixCount(slot, 'epic', null);
    gear[slot] = item(slot, stats.slice(n, n + count), { ilvl });
    n += count;
  }
  return gear;
}

const repeat = (stat: AffixStat, n: number): AffixStat[] => Array.from({ length: n }, () => stat);
/** Sustained output relative to no affixes: Power × average crit × haste (the design doc's model). */
function outputModel(gear: Equipped): number {
  const g = gearStats(gear);
  const crit = (c: number) => 1 + c * (CRIT_MULTIPLIER - 1);
  return (1 + g.bonus.power) * (crit(CRIT_CHANCE + g.bonus.crit) / crit(CRIT_CHANCE)) * (1 + g.bonus.haste);
}

describe('the affix curve', () => {
  it('gives cap × R / (R + 60): half the cap at 60 rating, and never the whole cap', () => {
    assert.equal(affixBonus('power', 0), 0);
    assert.ok(Math.abs(affixBonus('power', 60) - 0.15) < 1e-12);
    assert.ok(Math.abs(affixBonus('power', 180) - 0.225) < 1e-12);
    assert.ok(Math.abs(affixBonus('vigor', 120) - 0.2) < 1e-12);
    for (const s of AFFIX_STATS) assert.ok(affixBonus(s, 1e6) < AFFIXES[s].cap);
  });

  it('makes a mix beat stacking one stat, with the design doc’s numbers', () => {
    const allPower = outputModel(fullSet(repeat('power', 19)));
    const mix = outputModel(fullSet([...repeat('power', 7), ...repeat('crit', 6), ...repeat('haste', 6)]));
    assert.ok(Math.abs(allPower - 1.23) < 0.01, `all Power ×${allPower.toFixed(3)}`);
    assert.ok(Math.abs(mix - 1.34) < 0.015, `even mix ×${mix.toFixed(3)}`);
    assert.ok(mix > allPower);
    const survival = fullSet([...repeat('power', 7), ...repeat('vigor', 12)]);
    assert.ok(Math.abs(gearStats(survival).bonus.vigor - 0.2) < 0.01);
  });

  it('keeps iLvl 110 within 5% of iLvl 100, main lines included', () => {
    const stats = [...repeat('power', 7), ...repeat('crit', 6), ...repeat('haste', 6)];
    const at = (ilvl: number) => {
      const gear = fullSet(stats, ilvl);
      return (basePower(20) + gearStats(gear).power) * outputModel(gear);
    };
    const gain = at(110) / at(100) - 1;
    assert.ok(gain > 0.02 && gain < 0.05, `+${(gain * 100).toFixed(1)}%`);
  });
});

describe('items', () => {
  it('roll the affix count their rarity, slot and set call for', () => {
    const rng = new Mulberry32(3);
    for (let i = 0; i < 400; i++) {
      const rarity = (['common', 'uncommon', 'rare', 'epic'] as const)[i % 4];
      const it = rollItem(rng, i + 1, { ilvl: 50, tier: 0, rarity });
      assert.equal(it.affixes.length, RARITY[rarity].affixes + (it.slot === 'charm' ? 1 : 0));
    }
    const set = rollItem(rng, 999, { ilvl: 70, tier: 1, rarity: 'epic', set: 'frostward' });
    assert.ok(ARMOUR_SLOTS.includes(set.slot) && set.set === 'frostward' && set.affixes.length === 2);
    const legendary = rollItem(rng, 1000, { ilvl: 100, tier: 2, rarity: 'rare', legendary: 'pipsLuckyQuiver' });
    assert.equal(legendary.rarity, 'legendary');
    assert.equal(legendary.slot, 'charm');
    assert.equal(legendary.affixes.length, 3, 'two, plus the charm’s extra');
  });

  it('are named for their slot, their strongest affix, their set or their legend', () => {
    assert.equal(itemName(item('helm', ['vigor', 'haste', 'vigor']), 'sword'), 'Helm of Vigor');
    assert.equal(itemName(item('weapon', []), 'bow'), 'Bow');
    assert.equal(itemName(item('weapon', []), 'bell'), 'Bell');
    assert.equal(itemName(item('boots', ['crit', 'crit'], { set: 'emberfall' }), 'sword'), 'Emberfall Boots');
    assert.equal(itemName(item('charm', ['crit', 'crit', 'power'], { legendary: 'pipsLuckyQuiver' }), 'bow'), 'Pip’s Lucky Quiver');
  });

  it('drop at five item levels per level of the source, capped by the hero and at 110', () => {
    assert.equal(dropIlvl(14, 20, 1), 75, 'the Frost Heart boss is level 14');
    assert.equal(dropIlvl(20, 12, 0), 60, 'never above your own level');
    assert.equal(dropIlvl(20, 20, 2), 110);
    assert.equal(upgradeCeiling(0, 20), 100);
    assert.equal(upgradeCeiling(1, 20), 105);
    assert.equal(upgradeCeiling(2, 20), 110);
    assert.equal(upgradeCeiling(2, 8), 50, 'five per hero level, plus the tier');
  });
});

describe('what gear adds up to', () => {
  it('turns the old weapon tiers into weapons that give the same Power', () => {
    for (let tier = 0; tier <= 5; tier++) {
      const gear = tier ? { weapon: item('weapon', [], { rarity: 'common', ilvl: tier * LEGACY_ILVL_PER_TIER }) } : {};
      const power = heroStats({ cls: 'ranger', specs: {}, talents: {}, gear }, 9).power;
      assert.ok(Math.abs(power - (10 + 3.4 * 8 + 4 * tier)) < 1e-9, `tier ${tier}: ${power}`);
    }
  });

  it('adds the weapon to base Power, multiplies by the Power bonus, and adds armour health before the health group', () => {
    const gear: Equipped = {
      weapon: item('weapon', ['power', 'power', 'power']),
      helm: item('helm', ['vigor', 'vigor', 'vigor']),
      chest: item('chest', ['crit', 'haste', 'haste']),
    };
    const s = heroStats({ cls: 'warden', specs: {}, talents: {}, gear }, 20);
    const g = s.gear;
    assert.equal(g.power, 20);
    assert.equal(g.health, 80);
    assert.ok(Math.abs(s.power - (basePower(20) + 20) * (1 + affixBonus('power', 30))) < 1e-9);
    assert.equal(s.maxHp, Math.round((maxHpFor(20) * CLASSES.warden.health + 80) * (1 + affixBonus('vigor', 30))));
    assert.ok(Math.abs((s.passive.crit ?? 0) - affixBonus('crit', 10)) < 1e-12);
    assert.ok(Math.abs((s.passive.haste ?? 0) - affixBonus('haste', 20)) < 1e-12);
  });

  it('counts set pieces: two give a passive, four a proc', () => {
    const piece = (slot: GearSlot) => item(slot, ['power', 'crit'], { set: 'frostward' });
    const two = gearStats({ helm: piece('helm'), chest: piece('chest') });
    assert.equal(two.passive.maxHp, 0.08);
    assert.equal(two.procs.length, 0);
    const four = gearStats({ helm: piece('helm'), chest: piece('chest'), gloves: piece('gloves'), boots: piece('boots') });
    assert.equal(four.procs[0]?.kind, 'lowHealthShield');
  });

  it('counts gear at the matched level in a duel', () => {
    const gear: Equipped = { weapon: item('weapon', ['power', 'power', 'power'], { ilvl: 100, tier: 1 }) };
    assert.equal(gearStats(gear, 8).power, 0.2 * (5 * 8 + 5));
    assert.equal(gearStats(gear, 20).power, 20);
  });

  it('lets one legendary be worn, and only its own spec uses it', () => {
    const quiver = item('charm', ['crit', 'crit', 'power'], { rarity: 'legendary', legendary: 'pipsLuckyQuiver' });
    const treads = item('boots', ['crit', 'crit'], { rarity: 'legendary', legendary: 'tanglewoodTreads' });
    assert.match(canWear({ charm: quiver }, treads) ?? '', /one legendary/);
    assert.equal(canWear({ charm: quiver }, { ...quiver, id: 77 }), null, 'replacing it in its own slot is fine');
    const as = (spec: 'sharpshooter' | 'trapper') => heroStats({ cls: 'ranger', specs: { ranger: spec }, talents: {}, gear: { charm: quiver } }, 20);
    assert.equal(as('sharpshooter').loadout.legendary?.id, 'pipsLuckyQuiver');
    assert.equal(as('trapper').loadout.legendary, null);
    assert.equal(heroStats({ cls: 'ranger', specs: { ranger: 'sharpshooter' }, talents: {}, gear: { charm: quiver } }, 9).loadout.legendary, null, 'specs open at 10');
  });

  it('has one legendary per specialization, each changing a skill of its own class', () => {
    const specs = CLASS_IDS.flatMap((c) => CLASSES[c].specs.map((s) => ({ cls: c, spec: s.id })));
    assert.equal(LEGENDARY_IDS.length, specs.length);
    for (const { cls, spec } of specs) {
      const legendary = LEGENDARY_IDS.map((id) => LEGENDARIES[id]).filter((l) => l.spec === spec);
      assert.equal(legendary.length, 1, spec);
      const l = legendary[0]!;
      const own = new Set(CLASSES[cls].skills.map((s) => s.id));
      if (l.change) assert.ok(own.has(l.change.skill), `${l.id} changes ${l.change.skill}`);
      if (l.echo) assert.ok(own.has(l.echo.skill) && own.has(l.echo.cast), l.id);
      assert.ok((l.change?.damage ?? 1) <= 1.15 && (l.change?.healing ?? 1) <= 1.15);
    }
  });
});

describe('gear messages', () => {
  it('accept the six gear actions and reject anything else', () => {
    const ok = (op: unknown) => parseClientMessage({ t: 'gear', op }).ok;
    assert.ok(ok({ kind: 'equip', item: 4 }));
    assert.ok(ok({ kind: 'unequip', slot: 'charm' }));
    assert.ok(ok({ kind: 'salvage', items: [1, 2, 3] }));
    assert.ok(ok({ kind: 'upgrade', item: 9 }));
    assert.ok(ok({ kind: 'reforge', item: 9, affix: 2, stat: 'haste' }));
    assert.ok(ok({ kind: 'craft', slot: 'boots' }));
    assert.equal(ok({ kind: 'equip', item: -1 }), false);
    assert.equal(ok({ kind: 'unequip', slot: 'cape' }), false);
    assert.equal(ok({ kind: 'salvage', items: [] }), false);
    assert.equal(ok({ kind: 'reforge', item: 9, affix: 4, stat: 'haste' }), false);
    assert.equal(ok({ kind: 'reforge', item: 9, affix: 0, stat: 'luck' }), false);
    assert.equal(ok({ kind: 'polish', item: 9 }), false);
    assert.equal(parseClientMessage({ t: 'npc', npc: 'oda', action: 'sharpen', arg: null }).ok, false, 'sharpening is gone');
  });
});
