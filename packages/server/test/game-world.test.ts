import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { NPCS, QUESTS, type InputFrame } from '@lanternwood/shared';
import { makeWorld, monsterOf, runTicks, spawnHero, standNextTo } from './support';

const forward = (seq: number): InputFrame => ({ seq, fwd: 1, strafe: 0, yaw: 0, jump: false, swim: false });

describe('GameWorld', () => {
  it('spawns heroes on the plaza and lets them settle on the ground', () => {
    const world = makeWorld();
    const hero = spawnHero(world);
    // Heroes are simulated only when their input frames arrive, so send idle frames.
    world.queueInput(hero.id, Array.from({ length: 20 }, (_, i) => ({ ...forward(i + 1), fwd: 0 })));
    runTicks(world, 20);
    assert.ok(Math.abs(hero.body.y - 12.5) < 1e-6, `y = ${hero.body.y}`);
  });

  it('simulates at most one input frame per tick, so clients cannot speed hack', () => {
    const world = makeWorld();
    const hero = spawnHero(world);
    world.queueInput(hero.id, Array.from({ length: 30 }, (_, i) => forward(i + 1)));
    runTicks(world, 5);
    assert.equal(hero.lastInputSeq, 5);
  });

  it('ignores replayed and out-of-order frames', () => {
    const world = makeWorld();
    const hero = spawnHero(world);
    world.queueInput(hero.id, [forward(1), forward(2), forward(3)]);
    runTicks(world, 3);
    const z = hero.body.z;
    world.queueInput(hero.id, [forward(2)]);
    runTicks(world, 2);
    assert.equal(hero.lastInputSeq, 3);
    assert.equal(hero.body.z, z);
  });

  it('rescues a hero who falls off the island and counts the fall', () => {
    const world = makeWorld();
    const hero = spawnHero(world);
    hero.body.y = -60;
    world.step(0.05);
    assert.ok(hero.body.y > 10);
    assert.equal(hero.progress.falls, 1);
    assert.ok(world.drainEvents().some((r) => r.event.e === 'respawned'));
  });

  it('only lets heroes trade with an NPC they are standing next to', () => {
    const world = makeWorld();
    const hero = spawnHero(world);
    hero.progress.gold = 100;
    const oda = NPCS.find((n) => n.id === 'oda')!;
    Object.assign(hero.body, { x: 40, z: 40 });
    assert.equal(world.execute(hero.id, { kind: 'npc', npc: 'oda', action: 'buyTonic' }).ok, false);
    Object.assign(hero.body, { x: oda.x + 1, z: oda.z });
    const tonics = hero.progress.tonics;
    assert.ok(world.execute(hero.id, { kind: 'npc', npc: 'oda', action: 'buyTonic' }).ok);
    assert.equal(hero.progress.tonics, tonics + 1);
    assert.equal(hero.progress.gold, 85);
    assert.equal(world.execute(hero.id, { kind: 'npc', npc: 'oda', action: 'questAccept' }).ok, false);
  });

  it('runs the first quest from acceptance to reward', () => {
    const world = makeWorld();
    const hero = spawnHero(world);
    const maren = NPCS.find((n) => n.id === 'maren')!;
    const atMaren = (): void => void Object.assign(hero.body, { x: maren.x, z: maren.z + 1.5 });

    atMaren();
    assert.ok(world.execute(hero.id, { kind: 'npc', npc: 'maren', action: 'questAccept' }).ok);
    assert.equal(hero.progress.questState, 'active');

    for (let i = 0; i < QUESTS[0]!.need; i++) {
      const puffcap = monsterOf(world, 'puffcap', i);
      standNextTo(hero, puffcap);
      puffcap.hp = 1;
      hero.cooldowns.strike = 0;
      assert.ok(world.execute(hero.id, { kind: 'skill', skill: 'strike', target: puffcap.id }).ok);
    }
    assert.equal(hero.progress.questState, 'ready');

    atMaren();
    const gold = hero.progress.gold;
    const tonics = hero.progress.tonics;
    assert.ok(world.execute(hero.id, { kind: 'npc', npc: 'maren', action: 'questTurnIn' }).ok);
    assert.equal(hero.progress.quest, 1);
    assert.equal(hero.progress.questState, 'available');
    assert.equal(hero.progress.gold, gold + QUESTS[0]!.gold);
    assert.equal(hero.progress.tonics, tonics + QUESTS[0]!.tonics);
  });

  it('revives a defeated hero in town with full health', () => {
    const world = makeWorld();
    const hero = spawnHero(world);
    hero.dead = true;
    hero.hp = 0;
    assert.ok(world.execute(hero.id, { kind: 'respawn' }).ok);
    assert.equal(hero.dead, false);
    assert.equal(hero.hp, hero.maxHp);
    assert.equal(world.execute(hero.id, { kind: 'respawn' }).ok, false);
  });
});

describe('MonsterAi', () => {
  it('aggressive monsters chase and hurt nearby heroes', () => {
    const world = makeWorld();
    const hero = spawnHero(world);
    const boar = monsterOf(world, 'boar');
    standNextTo(hero, boar, 3);
    runTicks(world, 80);
    assert.equal(boar.mode, 'chase');
    assert.ok(hero.hp < hero.maxHp);
  });

  it('passive monsters ignore heroes until attacked', () => {
    const world = makeWorld();
    const hero = spawnHero(world);
    const puffcap = monsterOf(world, 'puffcap');
    standNextTo(hero, puffcap, 1);
    runTicks(world, 40);
    assert.equal(puffcap.mode, 'idle');
    standNextTo(hero, puffcap, 1);
    assert.ok(world.execute(hero.id, { kind: 'skill', skill: 'strike', target: puffcap.id }).ok);
    runTicks(world, 2);
    assert.equal(puffcap.mode, 'chase');
  });

  it('gives up and walks home when the hero runs past its leash', () => {
    const world = makeWorld();
    const hero = spawnHero(world);
    const boar = monsterOf(world, 'boar');
    standNextTo(hero, boar, 3);
    runTicks(world, 10);
    assert.equal(boar.mode, 'chase');
    Object.assign(hero.body, { x: 0, y: 12.5, z: 0 });
    runTicks(world, 400);
    assert.notEqual(boar.mode, 'chase');
    assert.ok(boar.distanceFromSpawn < 3);
  });

  it('respawns killed monsters after their timer', () => {
    const world = makeWorld();
    const hero = spawnHero(world);
    const puffcap = monsterOf(world, 'puffcap');
    standNextTo(hero, puffcap);
    puffcap.hp = 1;
    world.execute(hero.id, { kind: 'skill', skill: 'strike', target: puffcap.id });
    assert.equal(puffcap.alive, false);
    Object.assign(hero.body, { x: 0, y: 12.5, z: 0 });
    runTicks(world, Math.ceil(puffcap.def.respawnSeconds / 0.05) + 5);
    assert.equal(puffcap.alive, true);
    assert.equal(puffcap.hp, puffcap.maxHp);
  });
});
