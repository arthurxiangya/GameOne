import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PHYSICS, SIM_DT, chainById, findNpc, type InputFrame } from '@lanternwood/shared';
import { INITIAL_INPUT_CREDIT, MAX_INPUT_BACKLOG, MAX_INPUT_CREDIT } from '../src/application/game-world';
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

  it('never lets a flood of input move a hero faster than real time allows', () => {
    const world = makeWorld();
    const hero = spawnHero(world);
    world.queueInput(hero.id, [forward(1)]);
    world.step(0.05);
    const start = { x: hero.body.x, z: hero.body.z };
    world.queueInput(hero.id, Array.from({ length: 30 }, (_, i) => forward(i + 2)));
    runTicks(world, 5);
    const moved = Math.hypot(hero.body.x - start.x, hero.body.z - start.z);
    const allowed = (INITIAL_INPUT_CREDIT + 5) * PHYSICS.walkSpeed * SIM_DT;
    assert.ok(moved <= allowed + 1e-6, `moved ${moved.toFixed(2)} blocks, allowed ${allowed.toFixed(2)}`);
    assert.ok(hero.inputQueue.length <= MAX_INPUT_BACKLOG);
  });

  it('absorbs network jitter without building an input queue', () => {
    const world = makeWorld();
    const hero = spawnHero(world);
    let seq = 0;
    for (let tick = 0; tick < 40; tick++) {
      // Frames arrive in pairs every other tick: the same rate as the server, but bunched.
      if (tick % 2 === 0) world.queueInput(hero.id, [forward(++seq), forward(++seq)]);
      world.step(0.05);
      assert.equal(hero.lastInputSeq, seq, `tick ${tick}: everything received so far is applied`);
    }
  });

  it('catches up input that a network hiccup delayed, all in one tick', () => {
    const world = makeWorld();
    const hero = spawnHero(world);
    runTicks(world, 12); // 0.6 s with nothing arriving
    world.queueInput(hero.id, Array.from({ length: 12 }, (_, i) => forward(i + 1)));
    world.step(0.05);
    assert.equal(hero.lastInputSeq, 12);
    assert.equal(hero.inputQueue.length, 0);
  });

  it('keeps input credit on real time when the simulation has to skip time', () => {
    const world = makeWorld();
    const hero = spawnHero(world);
    world.step(0.05);
    world.creditRealTime(0.6); // the loop fell behind and dropped 0.6 s
    world.queueInput(hero.id, Array.from({ length: 16 }, (_, i) => forward(i + 1)));
    world.step(0.05);
    assert.equal(hero.lastInputSeq, 16, 'input sent during the skipped time is applied, not dropped');
    assert.equal(hero.inputQueue.length, 0);
  });

  it('drops stale input after a long stall instead of lagging behind for good', () => {
    const world = makeWorld();
    const hero = spawnHero(world);
    runTicks(world, 60); // 3 s stall: more than the bank can cover
    world.queueInput(hero.id, Array.from({ length: 40 }, (_, i) => forward(i + 1)));
    world.step(0.05);
    assert.ok(hero.inputQueue.length <= MAX_INPUT_BACKLOG);
    assert.ok(hero.lastInputSeq >= 40 - MAX_INPUT_BACKLOG, 'skipped frames are acknowledged');
    assert.ok(MAX_INPUT_CREDIT * SIM_DT <= 1.0001, 'the bank never covers more than a second');
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
    const oda = findNpc(world.npcs, 'oda')!;
    Object.assign(hero.body, { x: 40, z: 40 });
    assert.equal(world.execute(hero.id, { kind: 'npc', npc: 'oda', action: 'buyTonic', arg: null }).ok, false);
    Object.assign(hero.body, { x: oda.x + 1, z: oda.z });
    const tonics = hero.progress.tonics;
    assert.ok(world.execute(hero.id, { kind: 'npc', npc: 'oda', action: 'buyTonic', arg: null }).ok);
    assert.equal(hero.progress.tonics, tonics + 1);
    assert.equal(hero.progress.gold, 85);
    assert.equal(world.execute(hero.id, { kind: 'npc', npc: 'oda', action: 'accept', arg: 'main' }).ok, false);
    const maren = findNpc(world.npcs, 'maren')!;
    Object.assign(hero.body, { x: maren.x + 1, z: maren.z });
    assert.equal(world.execute(hero.id, { kind: 'npc', npc: 'maren', action: 'buyTonic', arg: null }).ok, false, 'only the smith sells tonics');
  });

  it('runs the first quest from acceptance to reward', () => {
    const world = makeWorld();
    const hero = spawnHero(world);
    const maren = findNpc(world.npcs, 'maren')!;
    const first = chainById('main').steps[0]!;
    const atMaren = (): void => void Object.assign(hero.body, { x: maren.x, z: maren.z + 1.5 });

    atMaren();
    assert.ok(world.execute(hero.id, { kind: 'npc', npc: 'maren', action: 'accept', arg: 'main' }).ok);
    assert.equal(hero.progress.story.main.state, 'active');

    for (let i = 0; i < (first.objective.kind === 'defeat' ? first.objective.count : 0); i++) {
      const puffcap = monsterOf(world, 'puffcap', i);
      standNextTo(hero, puffcap);
      puffcap.hp = 1;
      hero.cooldowns.clear();
      assert.ok(world.execute(hero.id, { kind: 'skill', skill: 'slash', target: puffcap.id }).ok);
    }
    assert.equal(hero.progress.story.main.state, 'ready');

    atMaren();
    const gold = hero.progress.gold;
    const tonics = hero.progress.tonics;
    assert.ok(world.execute(hero.id, { kind: 'npc', npc: 'maren', action: 'turnIn', arg: 'main' }).ok);
    assert.equal(hero.progress.story.main.step, 1);
    assert.equal(hero.progress.story.main.state, 'available', 'Maren hands out each main quest herself');
    assert.equal(hero.progress.gold, gold + first.reward.gold);
    assert.equal(hero.progress.tonics, tonics + (first.reward.tonics ?? 0));
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
    assert.ok(world.execute(hero.id, { kind: 'skill', skill: 'slash', target: puffcap.id }).ok);
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
    world.execute(hero.id, { kind: 'skill', skill: 'slash', target: puffcap.id });
    assert.equal(puffcap.alive, false);
    Object.assign(hero.body, { x: 0, y: 12.5, z: 0 });
    runTicks(world, Math.ceil(puffcap.def.respawnSeconds / 0.05) + 5);
    assert.equal(puffcap.alive, true);
    assert.equal(puffcap.hp, puffcap.maxHp);
  });
});
