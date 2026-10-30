import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  EGG_HATCH_KILLS,
  MOUNT_CALL_SECONDS,
  PHYSICS,
  SIM_DT,
  findNpc,
  petBonusAt,
  petXpToNext,
  type InputFrame,
} from '@lanternwood/shared';
import type { GameWorld } from '../src/application/game-world';
import type { Player } from '../src/domain/entities/player';
import { parsePlayerRecord } from '../src/domain/player-record';
import { constantRandom, makeWorld, monsterOf, runTicks, spawnHero, standAt, standNextTo } from './support';

/** Straight down the south road from the spawn point, which is open ground. */
const forward = (seq: number): InputFrame => ({ seq, fwd: 1, strafe: 0, yaw: Math.PI, jump: false, swim: false });

/** Walks forward for `ticks` ticks on flat town ground and returns the distance covered. */
function walk(world: GameWorld, hero: Player, ticks: number, from = 1): number {
  Object.assign(hero.body, { x: 0, y: 12.55, z: 5, vx: 0, vy: 0, vz: 0 });
  world.queueInput(hero.id, Array.from({ length: 4 }, (_, i) => ({ ...forward(from + i), fwd: 0 })));
  runTicks(world, 4);
  const start = { x: hero.body.x, z: hero.body.z };
  for (let i = 0; i < ticks; i++) {
    world.queueInput(hero.id, [forward(from + 4 + i)]);
    world.step(SIM_DT);
  }
  return Math.hypot(hero.body.x - start.x, hero.body.z - start.z);
}

const ride = (world: GameWorld, hero: Player): void => {
  assert.ok(world.execute(hero.id, { kind: 'mount', on: true }).ok);
  runTicks(world, Math.ceil(MOUNT_CALL_SECONDS / SIM_DT) + 1);
  assert.equal(hero.riding, hero.progress.mount);
};

describe('mounts', () => {
  it('needs a mount, then rides 60% faster once the call finishes', () => {
    const world = makeWorld();
    const hero = spawnHero(world, 'Rider', 6);
    assert.equal(world.execute(hero.id, { kind: 'mount', on: true }).ok, false, 'no mount yet');
    const onFoot = walk(world, hero, 10);
    hero.progress.mounts.push('strider');
    hero.progress.mount = 'strider';
    ride(world, hero);
    const mounted = walk(world, hero, 10, 100);
    assert.ok(mounted > onFoot * 1.45, `on foot ${onFoot.toFixed(2)}, mounted ${mounted.toFixed(2)}`);
    assert.ok(mounted <= 10 * SIM_DT * PHYSICS.walkSpeed * 1.6 + 1e-6, 'never faster than the mount allows');
  });

  it('cannot be called mid-fight, and taking damage or using a skill knocks you off', () => {
    const world = makeWorld();
    const hero = spawnHero(world, 'Knocked', 6);
    hero.progress.mounts.push('strider');
    hero.progress.mount = 'strider';
    ride(world, hero);
    hero.mp = 100;
    assert.ok(world.execute(hero.id, { kind: 'skill', skill: 'inferno', target: null }).ok);
    assert.equal(hero.riding, null, 'using a skill dismounts');
    assert.equal(world.execute(hero.id, { kind: 'mount', on: true }).ok, false, 'just attacked');
    hero.lastAttackAt = -100;
    ride(world, hero);
    const boar = monsterOf(world, 'boar');
    standNextTo(hero, boar);
    boar.provoke();
    boar.addThreat(hero.id, 1);
    runTicks(world, 80);
    assert.equal(hero.riding, null, 'taking damage dismounts');
  });

  it('sells the Meadow Strider at level 5 and gives the Bramble Hog for The Lantern Thief', () => {
    const world = makeWorld();
    const hero = spawnHero(world, 'Buyer', 4);
    hero.progress.gold = 300;
    standAt(hero, findNpc(world.npcs, 'oda')!);
    const buy = () => world.execute(hero.id, { kind: 'npc', npc: 'oda', action: 'buy', arg: 'strider' });
    assert.equal(buy().ok, false, 'level 5 needed');
    hero.progress.level = 5;
    assert.ok(buy().ok);
    assert.equal(hero.progress.gold, 50);
    assert.deepEqual(hero.progress.mounts, ['strider']);
    assert.equal(hero.progress.mount, 'strider');
    assert.equal(buy().ok, false, 'bought once');

    hero.progress.story.thief = { step: 4, progress: 0, state: 'active' };
    standAt(hero, findNpc(world.npcs, 'bryn')!);
    assert.ok(world.execute(hero.id, { kind: 'npc', npc: 'bryn', action: 'talk', arg: 'thief' }).ok);
    assert.ok(hero.progress.mounts.includes('hog'));
    assert.ok(world.execute(hero.id, { kind: 'chooseMount', mount: 'hog' }).ok);
    assert.equal(world.execute(hero.id, { kind: 'chooseMount', mount: 'elk' }).ok, false, 'not owned');
  });
});

describe('pets', () => {
  it('hatches an egg after enough victories, and the pet follows you', () => {
    const world = makeWorld(constantRandom(0.5));
    const hero = spawnHero(world, 'Hatcher', 3);
    hero.progress.marks = 10;
    standAt(hero, findNpc(world.npcs, 'oda')!);
    assert.ok(world.execute(hero.id, { kind: 'npc', npc: 'oda', action: 'buy', arg: 'eggFox' }).ok);
    assert.deepEqual(hero.progress.eggs, [{ pet: 'fox', kills: 0 }]);
    for (let i = 0; i < EGG_HATCH_KILLS; i++) {
      const m = monsterOf(world, 'puffcap', i % 10);
      if (!m.alive) m.respawn(m.y);
      standNextTo(hero, m);
      m.hp = 1;
      hero.cooldowns.clear();
      world.execute(hero.id, { kind: 'skill', skill: 'slash', target: m.id });
    }
    assert.deepEqual(hero.progress.eggs, []);
    assert.equal(hero.progress.pet, 'fox');
    assert.equal(hero.progress.pets[0]?.level, 1);
    assert.ok(world.drainEvents().some((r) => r.event.e === 'banner'));
  });

  it('levels the active pet with a share of the hero’s XP, and its bonus grows with it', () => {
    const world = makeWorld();
    const hero = spawnHero(world, 'Trainer', 5);
    hero.progress.pets.push({ id: 'moth', name: 'Moth', level: 1, xp: 0 });
    hero.progress.pet = 'moth';
    const m = monsterOf(world, 'boar');
    standNextTo(hero, m);
    m.hp = 1;
    world.execute(hero.id, { kind: 'skill', skill: 'slash', target: m.id });
    assert.ok(hero.progress.pets[0]!.xp > 0);
    hero.progress.pets[0]!.xp = petXpToNext(1) - 1;
    const m2 = monsterOf(world, 'boar', 1);
    standNextTo(hero, m2);
    m2.hp = 1;
    hero.cooldowns.clear();
    world.execute(hero.id, { kind: 'skill', skill: 'slash', target: m2.id });
    assert.equal(hero.progress.pets[0]!.level, 2);
    assert.ok(Math.abs(petBonusAt('moth', 10, 'xp') - 0.1) < 1e-9);
    assert.ok(Math.abs(petBonusAt('moth', 1, 'xp') - 0.01) < 1e-9);
  });

  it('chooses and renames only pets you have', () => {
    const world = makeWorld();
    const hero = spawnHero(world, 'Namer', 2);
    assert.equal(world.execute(hero.id, { kind: 'choosePet', pet: 'frog' }).ok, false);
    hero.progress.pets.push({ id: 'frog', name: 'Reed Frogling', level: 1, xp: 0 });
    assert.ok(world.execute(hero.id, { kind: 'choosePet', pet: 'frog' }).ok);
    assert.ok(world.execute(hero.id, { kind: 'renamePet', pet: 'frog', name: 'Ribbit' }).ok);
    assert.equal(hero.progress.pets[0]!.name, 'Ribbit');
    assert.ok(world.execute(hero.id, { kind: 'choosePet', pet: null }).ok);
    assert.equal(hero.progress.pet, null);
  });
});

describe('saved mounts and pets', () => {
  it('gives the Frost Elk to heroes who beat the Warden before mounts existed', () => {
    const record = parsePlayerRecord({
      accountId: 'abc', name: 'Champ', level: 15, xp: 0, gold: 0, tonics: 0, weapon: 5, falls: 2,
      quest: 6, questProgress: 0, questState: 'done',
    })!;
    assert.deepEqual(record.titles, ['hero']);
    assert.deepEqual(record.mounts, ['elk']);
    assert.equal(record.mount, 'elk');
  });

  it('drops pets and eggs it does not recognise, and eggs for pets already owned', () => {
    const record = parsePlayerRecord({
      accountId: 'abc', name: 'Keeper', level: 5, xp: 0, gold: 0, tonics: 0, weapon: 0, falls: 0,
      pets: [{ id: 'fox', name: 'Kit', level: 4, xp: 20 }, { id: 'dragon', level: 9 }, { id: 'fox', level: 1 }],
      pet: 'fox',
      eggs: [{ pet: 'fox', kills: 3 }, { pet: 'frog', kills: 99 }, { pet: 'unicorn', kills: 1 }],
    })!;
    assert.deepEqual(record.pets, [{ id: 'fox', name: 'Kit', level: 4, xp: 20 }]);
    assert.equal(record.pet, 'fox');
    assert.deepEqual(record.eggs, [{ pet: 'frog', kills: 0 }]);
  });
});
