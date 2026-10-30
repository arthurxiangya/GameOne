import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ALL_SKILL_IDS,
  CLASSES,
  CLASS_IDS,
  MODIFIER_CAP,
  SPEC_LEVEL,
  TALENTS,
  TALENT_LEVELS,
  activeSpec,
  activeTalents,
  describeSkill,
  isOffensive,
  kitFor,
  loadout,
  type ClassSkillId,
  type SkillDef,
} from '../src/index';

const damageK = (s: SkillDef): number => s.effects.reduce((k, e) => (e.kind === 'damage' ? k + e.k : k), 0);

describe('class configs', () => {
  it('cover every role, with four skills each in the agreed slot order', () => {
    assert.deepEqual(new Set(CLASS_IDS.map((c) => CLASSES[c].role)), new Set(['tank', 'healer', 'damage', 'support']));
    for (const c of CLASS_IDS) {
      const def = CLASSES[c];
      assert.equal(def.skills.length, 4, c);
      assert.deepEqual(def.skills.map((s) => s.unlockLevel), [1, 1, 2, 4], c);
      const basic = def.skills[0]!;
      assert.ok(basic.cost === 0 && basic.cooldown <= 1.4, `${c}: skill 1 is a free, quick basic attack`);
      assert.ok(def.rotation.every((r) => def.skills.some((s) => s.id === r.skill)), `${c}: rotation uses its own skills`);
    }
  });

  it('give every skill a unique id and a filled-in tooltip', () => {
    assert.equal(new Set(ALL_SKILL_IDS).size, ALL_SKILL_IDS.length);
    for (const c of CLASS_IDS) {
      for (const spec of [null, ...CLASSES[c].specs]) {
        for (const s of kitFor(c, spec)) {
          const text = describeSkill(s, 40);
          assert.doesNotMatch(text, /[{}]/, `${s.id}: ${text}`);
          assert.ok(s.cooldown > 0, s.id);
        }
      }
    }
  });

  it('keep specs inside their class, under the caps, and within +30% of any skill’s damage', () => {
    for (const c of CLASS_IDS) {
      const own = new Set(CLASSES[c].skills.map((s) => s.id));
      for (const spec of CLASSES[c].specs) {
        for (const id of Object.keys(spec.patch)) assert.ok(own.has(id as ClassSkillId), `${spec.id} patches ${id}`);
        for (const v of [spec.passive.damage, spec.passive.healing, spec.passive.crit, spec.passive.maxHp]) assert.ok((v ?? 0) <= MODIFIER_CAP);
        const base = kitFor(c, null);
        kitFor(c, spec).forEach((s, i) => {
          const before = damageK(base[i]!);
          if (before > 0) assert.ok(damageK(s) <= before * 1.3 + 1e-9, `${spec.id} raises ${s.id} too far`);
        });
      }
    }
  });

  it('open specs at level 10 only, and only for their own class', () => {
    assert.equal(activeSpec('ranger', { ranger: 'trapper' }, SPEC_LEVEL - 1), null);
    assert.equal(activeSpec('ranger', { ranger: 'trapper' }, SPEC_LEVEL)?.id, 'trapper');
    assert.equal(activeSpec('ranger', { warden: 'bulwark' }, 20), null);
  });

  it('call heals, shields and buffs peaceful, and anything that hurts or taunts an attack', () => {
    const kit = Object.fromEntries(CLASS_IDS.flatMap((c) => kitFor(c, null).map((s) => [s.id, s])));
    for (const id of ['mend', 'ward', 'peal', 'hymn', 'shieldWall', 'kindle']) assert.equal(isOffensive(kit[id]!), false, id);
    for (const id of ['slash', 'taunt', 'discord', 'radiance', 'volley']) assert.equal(isOffensive(kit[id]!), true, id);
  });

  it('give every class four rows of three talents, each changing only its own class and at most ×1.15', () => {
    const ids = CLASS_IDS.flatMap((c) => TALENTS[c].flat().map((t) => t.id));
    assert.equal(new Set(ids).size, ids.length, 'talent ids are unique');
    for (const c of CLASS_IDS) {
      assert.equal(TALENTS[c].length, TALENT_LEVELS.length);
      const own = new Set(CLASSES[c].skills.map((s) => s.id));
      for (const t of TALENTS[c].flat()) {
        assert.ok(t.change || t.passive, `${t.id} does something`);
        if (t.change) {
          assert.ok(own.has(t.change.skill), `${t.id} changes ${t.change.skill}`);
          assert.ok((t.change.damage ?? 1) <= 1.15 && (t.change.healing ?? 1) <= 1.15, `${t.id} multiplies too far`);
        }
      }
      for (const row of TALENTS[c]) assert.equal(row.length, 3);
    }
  });

  it('stack a spec and talents on the same skill: patch first, then each change', () => {
    const picks = { ranger: ['barbedArrows', null, 'cheapVolley', 'markingVolley'] };
    const gear = loadout('ranger', { specs: { ranger: 'trapper' }, talents: picks }, 20);
    const volley = gear.kit.find((s) => s.id === 'volley')!;
    assert.equal(volley.cost, 30 - 10, 'Trapper sets 30, Light Quiver takes 10 off');
    assert.equal(volley.cooldown, 7);
    assert.deepEqual(volley.effects.map((e) => e.kind), ['damage', 'status', 'status'], 'Trapper’s snare, then the mark');
    assert.ok(Math.abs(gear.kit[0]!.effects[0]!.kind === 'damage' ? (gear.kit[0]!.effects[0] as { k: number }).k - 0.85 * 1.15 : 1) < 1e-9);
    assert.deepEqual(activeTalents('ranger', picks.ranger, 14).map((t) => t.id), ['barbedArrows'], 'rows 3 and 4 are still closed at 14');
  });
});
