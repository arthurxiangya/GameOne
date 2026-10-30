import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  BAG_SIZE,
  FORGE,
  affixBonus,
  basePower,
  findNpc,
  weaponPrice,
  type AffixStat,
  type GearOp,
  type GearSlot,
  type Item,
  type SetId,
} from '@lanternwood/shared';
import type { GameWorld } from '../src/application/game-world';
import type { Player } from '../src/domain/entities/player';
import { newPlayerRecord, parsePlayerRecord, progressFromRecord, recordFromPlayer } from '../src/domain/player-record';
import { FakeCalendar, constantRandom, makeWorld, runTicks, spawnHero, standAt } from './support';

const gear = (world: GameWorld, p: Player, op: GearOp) => world.execute(p.id, { kind: 'gear', op });
const use = (world: GameWorld, p: Player, skill: string, target: number | null) => world.execute(p.id, { kind: 'skill', skill: skill as never, target });

function plaza(p: Player, x = 0): void {
  Object.assign(p.body, { x, z: 12, vx: 0, vy: 0, vz: 0 });
}

function calm(p: Player): void {
  p.lastAttackAt = -100;
  p.lastHurtAt = -100;
}

/** A new item for this hero. */
function make(p: Player, slot: GearSlot, affixes: AffixStat[], o: Partial<Item> = {}): Item {
  return { id: p.progress.itemSeq++, slot, rarity: 'rare', ilvl: 100, tier: 0, affixes, reforged: -1, set: null, legendary: null, ...o };
}

function wear(p: Player, ...items: Item[]): void {
  p.changeGear(() => (p.progress.gear = { ...p.progress.gear, ...Object.fromEntries(items.map((i) => [i.slot, i])) }));
}

const setOf = (p: Player, set: SetId): Item[] => (['helm', 'chest', 'gloves', 'boots'] as const).map((slot) => make(p, slot, ['power', 'crit'], { rarity: 'epic', set }));

describe('drops', () => {
  it('come from monsters on their own random stream, and a full bag salvages them into Embers', () => {
    const world = makeWorld(constantRandom(), new FakeCalendar(), constantRandom(0));
    const hero = spawnHero(world, 'Looter', 12, 'emberblade');
    plaza(hero);
    const kill = () => {
      const boar = world.spawnMonster('boar', 12, 2.2, 12, { damage: 0 });
      boar.hp = 1;
      hero.cooldowns.clear();
      assert.ok(use(world, hero, 'slash', boar.id).ok);
      assert.equal(boar.alive, false);
    };
    kill();
    assert.equal(hero.progress.bag.length, 1);
    assert.deepEqual({ ...hero.progress.bag[0]!, id: 0 }, { id: 0, slot: 'weapon', rarity: 'common', ilvl: 60, tier: 0, affixes: [], reforged: -1, set: null, legendary: null });
    hero.progress.bag = Array.from({ length: BAG_SIZE }, () => make(hero, 'helm', ['vigor', 'vigor']));
    kill();
    assert.equal(hero.progress.bag.length, BAG_SIZE);
    assert.equal(hero.progress.embers, 1, 'the common was salvaged on the spot');
  });

  it('fall from a boss to every hero near it, healers included, and to nobody far away', () => {
    const world = makeWorld(constantRandom(), new FakeCalendar(), constantRandom(0.3));
    const tank = spawnHero(world, 'Near', 20, 'warden');
    const healer = spawnHero(world, 'Healer', 20, 'lightkeeper');
    const away = spawnHero(world, 'Faraway', 20, 'ranger');
    plaza(tank);
    plaza(healer, -6);
    Object.assign(away.body, { x: 70, z: 12 });
    const boss = world.spawnMonster('warden', 14, 2.2, 12, { damage: 0, slamDamage: 0 });
    world.step(0.05);
    boss.hp = 1;
    assert.ok(use(world, tank, 'shieldBash', boss.id).ok);
    assert.equal(boss.alive, false);
    for (const hero of [tank, healer]) {
      assert.equal(hero.progress.bag.length, 1, hero.name);
      const item = hero.progress.bag[0]!;
      assert.equal(item.rarity, 'rare');
      assert.equal(item.ilvl, 75, 'level 14, plus the elite step');
      assert.equal(item.tier, 1);
    }
    assert.equal(away.progress.bag.length, 0);
  });

  it('give a specialized hero a chance at their own legendary from the raid stand-ins', () => {
    const world = makeWorld(constantRandom(), new FakeCalendar(), constantRandom(0.05));
    const ranger = spawnHero(world, 'Lucky', 20, 'ranger');
    ranger.progress.specs.ranger = 'sharpshooter';
    plaza(ranger);
    const knight = world.spawnMonster('gloomknight', 20, 4, 12, { damage: 0, slamDamage: 0 });
    world.step(0.05);
    knight.hp = 1;
    assert.ok(use(world, ranger, 'quickShot', knight.id).ok);
    runTicks(world, 10);
    assert.equal(knight.alive, false);
    const legendary = ranger.progress.bag.find((i) => i.legendary);
    assert.equal(legendary?.legendary, 'pipsLuckyQuiver');
    assert.equal(legendary?.ilvl, 110);
  });
});

describe('wearing gear', () => {
  it('changes Power and health at once, keeps your share of health, and waits until you are out of combat', () => {
    const world = makeWorld();
    const hero = spawnHero(world, 'Wearer', 20, 'ranger');
    calm(hero);
    const blade = make(hero, 'weapon', ['power', 'power']);
    const helm = make(hero, 'helm', ['vigor', 'vigor']);
    hero.progress.bag = [blade, helm];
    assert.ok(gear(world, hero, { kind: 'equip', item: blade.id }).ok);
    assert.ok(Math.abs(hero.attack - (basePower(20) + 20) * (1 + affixBonus('power', 20))) < 1e-9);
    const max = hero.maxHp;
    hero.hp = Math.round(max / 2);
    assert.ok(gear(world, hero, { kind: 'equip', item: helm.id }).ok);
    assert.ok(hero.maxHp > max + 40);
    assert.ok(Math.abs(hero.hp / hero.maxHp - 0.5) < 0.01, 'same share of health');
    assert.deepEqual(hero.progress.bag, []);

    hero.lastAttackAt = world.time;
    const fighting = gear(world, hero, { kind: 'unequip', slot: 'helm' });
    assert.match(fighting.ok ? '' : fighting.error, /fighting/);
    calm(hero);
    assert.ok(gear(world, hero, { kind: 'unequip', slot: 'helm' }).ok);
    assert.equal(hero.progress.bag[0], helm);
    assert.equal(hero.progress.gear.helm, undefined);
  });

  it('allows one legendary at a time, and salvages bag items for Embers by rarity', () => {
    const world = makeWorld();
    const hero = spawnHero(world, 'Picky', 20, 'ranger');
    calm(hero);
    const quiver = make(hero, 'charm', ['crit', 'crit', 'haste'], { rarity: 'legendary', legendary: 'pipsLuckyQuiver' });
    const treads = make(hero, 'boots', ['crit', 'crit'], { rarity: 'legendary', legendary: 'tanglewoodTreads' });
    wear(hero, quiver);
    hero.progress.bag = [treads, make(hero, 'helm', [], { rarity: 'common' }), make(hero, 'gloves', ['crit', 'crit', 'crit'], { rarity: 'epic' })];
    const second = gear(world, hero, { kind: 'equip', item: treads.id });
    assert.match(second.ok ? '' : second.error, /one legendary/);
    assert.ok(gear(world, hero, { kind: 'salvage', items: hero.progress.bag.map((i) => i.id) }).ok);
    assert.equal(hero.progress.embers, 16 + 1 + 8);
    assert.equal(gear(world, hero, { kind: 'salvage', items: [quiver.id] }).ok, false, 'worn items stay worn');
  });

  it('counts gear at the matched level in a duel', () => {
    const world = makeWorld();
    const hero = spawnHero(world, 'Duelist', 20, 'emberblade');
    wear(hero, make(hero, 'weapon', [], { rarity: 'common', ilvl: 100 }));
    assert.equal(hero.attack, basePower(20) + 20);
    hero.duelLevel = 8;
    assert.equal(hero.attack, basePower(8) + 0.2 * 40);
  });
});

describe('Smith Oda’s forge', () => {
  it('upgrades to the ceiling, reforges one affix, and crafts a rare for the slot you choose', () => {
    const world = makeWorld();
    const hero = spawnHero(world, 'Smithy', 12, 'emberblade');
    calm(hero);
    const helm = make(hero, 'helm', ['vigor', 'power'], { ilvl: 50 });
    hero.progress.bag = [helm];
    Object.assign(hero.progress, { embers: 100, marks: 5 });
    const away = gear(world, hero, { kind: 'upgrade', item: helm.id });
    assert.match(away.ok ? '' : away.error, /Visit Smith Oda/);
    standAt(hero, findNpc(world.npcs, 'oda')!);

    assert.ok(gear(world, hero, { kind: 'upgrade', item: helm.id }).ok);
    assert.ok(gear(world, hero, { kind: 'upgrade', item: helm.id }).ok);
    assert.equal(hero.progress.bag[0]!.ilvl, 60);
    const ceiling = gear(world, hero, { kind: 'upgrade', item: helm.id });
    assert.match(ceiling.ok ? '' : ceiling.error, /level 13/, 'five item levels per hero level');

    assert.ok(gear(world, hero, { kind: 'reforge', item: helm.id, affix: 0, stat: 'crit' }).ok);
    const other = gear(world, hero, { kind: 'reforge', item: helm.id, affix: 1, stat: 'haste' });
    assert.match(other.ok ? '' : other.error, /Only its reforged Crit/);
    assert.ok(gear(world, hero, { kind: 'reforge', item: helm.id, affix: 0, stat: 'haste' }).ok);
    assert.deepEqual(hero.progress.bag[0]!.affixes, ['haste', 'power']);
    assert.equal(hero.progress.embers, 100 - 2 * FORGE.upgrade.embers - 2 * FORGE.reforge.embers);
    assert.equal(hero.progress.marks, 3);

    assert.ok(gear(world, hero, { kind: 'craft', slot: 'boots' }).ok);
    const boots = hero.progress.bag[1]!;
    assert.equal(boots.slot, 'boots');
    assert.equal(boots.rarity, 'rare');
    assert.equal(boots.ilvl, 60);
    assert.equal(boots.affixes.length, 2);
    assert.equal(gear(world, hero, { kind: 'craft', slot: 'boots' }).ok, false, 'out of Embers and Marks');
  });

  it('upgrades a worn item in place, and sells a plain weapon at your level', () => {
    const world = makeWorld();
    const hero = spawnHero(world, 'Buyer', 9, 'warden');
    calm(hero);
    standAt(hero, findNpc(world.npcs, 'oda')!);
    hero.progress.gold = weaponPrice(9);
    assert.ok(world.execute(hero.id, { kind: 'npc', npc: 'oda', action: 'buyWeapon', arg: null }).ok);
    const weapon = hero.progress.bag[0]!;
    assert.deepEqual([weapon.slot, weapon.rarity, weapon.ilvl, hero.progress.gold], ['weapon', 'common', 45, 0]);
    assert.ok(gear(world, hero, { kind: 'equip', item: weapon.id }).ok);
    hero.progress.embers = FORGE.upgrade.embers;
    const ceiling = gear(world, hero, { kind: 'upgrade', item: weapon.id });
    assert.equal(ceiling.ok, false, 'already at five per level');
    hero.progress.level = 10;
    const before = hero.attack;
    assert.ok(gear(world, hero, { kind: 'upgrade', item: weapon.id }).ok);
    assert.equal(hero.progress.gear.weapon?.ilvl, 50);
    assert.ok(Math.abs(hero.attack - before - 1) < 1e-9, '+5 item levels on a weapon is +1 Power');
  });
});

describe('saving gear', () => {
  it('keeps gear, bag and Embers, drops broken items, and turns an old weapon tier into the same Power', () => {
    const world = makeWorld();
    const base = newPlayerRecord('acc', 'Saver', 'now');
    const { gear: _g, bag: _b, embers: _e, itemSeq: _s, ...old } = base;
    const legacy = parsePlayerRecord({ ...old, level: 15, weapon: 5 })!;
    assert.equal(legacy.gear.weapon?.ilvl, 100);
    const hero = world.spawnPlayer('acc', 0, progressFromRecord(legacy));
    assert.equal(hero.attack, basePower(15) + 20, 'tier 5 was +20 attack, and still is');

    const helm = make(hero, 'helm', ['vigor', 'crit'], { reforged: 1 });
    hero.progress.bag = [helm];
    hero.progress.embers = 33;
    const saved = JSON.parse(JSON.stringify(recordFromPlayer(base, hero, 'later')));
    const loaded = parsePlayerRecord(saved)!;
    assert.deepEqual(loaded.gear, hero.progress.gear);
    assert.deepEqual(loaded.bag, [helm]);
    assert.equal(loaded.embers, 33);
    assert.ok(loaded.itemSeq > helm.id);

    const damaged = parsePlayerRecord({
      ...saved,
      gear: { helm: saved.gear.weapon, charm: { ...helm, slot: 'charm' } },
      bag: [{ ...helm, affixes: ['luck', 'crit'] }, helm, helm, { ...helm, id: 999, ilvl: 400 }],
    })!;
    assert.deepEqual(damaged.gear, {}, 'a weapon in the helm slot, and a charm with too few affixes');
    assert.deepEqual(damaged.bag, [helm], 'unknown stats, repeated ids and impossible item levels are dropped');
  });
});

describe('set bonuses and legendaries in the engine', () => {
  it('Frostward shields a hero who drops below 40%, once every 30 s', () => {
    const world = makeWorld();
    const warden = spawnHero(world, 'Frosty', 20, 'warden');
    wear(warden, ...setOf(warden, 'frostward'));
    plaza(warden);
    world.spawnMonster('boar', 20, 2.2, 12, { huntRange: 12, maxHp: 1e6, damage: 100 });
    warden.hp = Math.round(warden.maxHp * 0.42);
    warden.lastHurtAt = world.time; // in combat, so no regeneration muddies the reading
    const before = warden.hp;
    for (let i = 0; i < 80 && warden.hp === before; i++) world.step(0.05);
    assert.ok(warden.hp < warden.maxHp * 0.4);
    assert.equal(warden.shield, Math.round(warden.attack * 2));
    assert.ok(Math.abs(warden.wardReadyAt - (world.time + 30)) < 2);
  });

  it('Emberfall burns what a critical hit lands on', () => {
    for (const worn of [false, true]) {
      const world = makeWorld(constantRandom(0));
      const blade = spawnHero(world, 'Burner', 20, 'emberblade');
      if (worn) wear(blade, ...setOf(blade, 'emberfall'));
      plaza(blade);
      const boar = world.spawnMonster('boar', 20, 2.2, 12, { maxHp: 1e6, damage: 0 });
      assert.ok(use(world, blade, 'slash', boar.id).ok);
      assert.equal(boar.statuses.has('emberfall', world.time), worn);
    }
  });

  it('Bellsong gives allies nearby 5% more damage when you use your fourth skill', () => {
    const world = makeWorld();
    const chimer = spawnHero(world, 'Ringer', 20, 'chimer');
    const ally = spawnHero(world, 'Friend', 20, 'emberblade');
    wear(chimer, ...setOf(chimer, 'bellsong'));
    plaza(chimer);
    plaza(ally, 4);
    world.step(0.05);
    chimer.mp = chimer.maxMp;
    assert.ok(use(world, chimer, 'hymn', null).ok);
    assert.ok(ally.statuses.has('bellsong', world.time));
    assert.ok(chimer.statuses.has('bellsong', world.time));
  });

  it('Frost Heart Aegis turns part of every blow back on the attacker after a Taunt', () => {
    const world = makeWorld();
    const warden = spawnHero(world, 'Aegis', 20, 'warden');
    warden.progress.specs.warden = 'bulwark';
    wear(warden, make(warden, 'chest', ['vigor', 'vigor'], { rarity: 'legendary', legendary: 'frostHeartAegis' }));
    plaza(warden);
    const boar = world.spawnMonster('boar', 20, 2.2, 12, { huntRange: 12, maxHp: 1e6, damage: 100 });
    world.step(0.05);
    assert.ok(use(world, warden, 'taunt', null).ok);
    assert.ok(warden.statuses.has('aegis', world.time));
    world.drainEvents();
    const hp = boar.hp;
    let taken = 0;
    for (let i = 0; i < 80 && taken === 0; i++) {
      world.step(0.05);
      for (const r of world.drainEvents()) if (r.event.e === 'dmg' && r.event.id === warden.id) taken = r.event.amt;
    }
    const reflected = hp - boar.hp;
    assert.ok(taken > 0 && Math.abs(reflected - taken * 0.4) <= 2, `took ${taken}, reflected ${reflected}`);
  });

  it('Pip’s Lucky Quiver looses a second, free Aimed Shot with every fourth', () => {
    const world = makeWorld();
    const ranger = spawnHero(world, 'Pip', 20, 'ranger');
    ranger.progress.specs.ranger = 'sharpshooter';
    wear(ranger, make(ranger, 'charm', ['crit', 'crit', 'power'], { rarity: 'legendary', legendary: 'pipsLuckyQuiver' }));
    plaza(ranger);
    const dummy = world.spawnMonster('golem', 20, 8, 12, { maxHp: 1e9, damage: 0, slamDamage: 0 });
    world.drainEvents();
    const cost = ranger.kit.find((s) => s.id === 'aimedShot')!.cost;
    for (let i = 0; i < 4; i++) {
      ranger.cooldowns.clear();
      ranger.mp = ranger.maxMp;
      assert.ok(use(world, ranger, 'aimedShot', dummy.id).ok);
    }
    const bolts = world.drainEvents().filter((r) => r.event.e === 'bolt').length;
    assert.equal(bolts, 5);
    assert.equal(ranger.mp, ranger.maxMp - cost, 'the free shot costs no Focus');
  });
});
