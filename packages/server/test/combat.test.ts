import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CLASSES } from '@lanternwood/shared';
import { makeWorld, monsterOf, runTicks, spawnHero, standNextTo } from './support';

const skillDef = (cls: keyof typeof CLASSES, id: string) => CLASSES[cls].skills.find((s) => s.id === id)!;

describe('combat', () => {
  it('Slash damages a monster in reach, builds Heat, reports it, and starts the cooldown', () => {
    const world = makeWorld();
    const hero = spawnHero(world);
    const puffcap = monsterOf(world, 'puffcap');
    standNextTo(hero, puffcap);

    const result = world.execute(hero.id, { kind: 'skill', skill: 'slash', target: puffcap.id });

    assert.ok(result.ok);
    assert.ok(puffcap.hp < puffcap.maxHp);
    assert.equal(hero.cooldown('slash'), skillDef('emberblade', 'slash').cooldown);
    assert.equal(hero.mp, 12, 'Slash builds 12 Heat');
    const events = world.drainEvents().map((r) => r.event);
    assert.ok(events.some((e) => e.e === 'dmg' && e.id === puffcap.id));
    assert.ok(events.some((e) => e.e === 'swing' && e.id === hero.id));
  });

  it('refuses a skill on cooldown, a target out of reach, and a skill from another class', () => {
    const world = makeWorld();
    const hero = spawnHero(world);
    const puffcap = monsterOf(world, 'puffcap');
    standNextTo(hero, puffcap);
    assert.ok(world.execute(hero.id, { kind: 'skill', skill: 'slash', target: puffcap.id }).ok);
    assert.equal(world.execute(hero.id, { kind: 'skill', skill: 'slash', target: puffcap.id }).ok, false);

    runTicks(world, 20);
    standNextTo(hero, puffcap, 8);
    const far = world.execute(hero.id, { kind: 'skill', skill: 'slash', target: puffcap.id });
    assert.equal(far.ok, false);
    assert.match(far.ok ? '' : far.error, /Too far/);

    const foreign = world.execute(hero.id, { kind: 'skill', skill: 'mend', target: null });
    assert.match(foreign.ok ? '' : foreign.error, /doesn't know/);
  });

  it('a projectile costs its resource and lands only after its flight time', () => {
    const world = makeWorld();
    const hero = spawnHero(world, 'Archer', 1, 'ranger');
    const boar = monsterOf(world, 'boar');
    standNextTo(hero, boar, 10);
    const focus = hero.mp;

    assert.ok(world.execute(hero.id, { kind: 'skill', skill: 'aimedShot', target: boar.id }).ok);
    assert.equal(hero.mp, focus - skillDef('ranger', 'aimedShot').cost);
    assert.equal(boar.hp, boar.maxHp, 'no damage before the arrow arrives');
    world.step(0.05);
    world.step(0.5);
    assert.ok(boar.hp < boar.maxHp);
  });

  it('locks skills until their unlock level, and needs enough resource', () => {
    const world = makeWorld();
    const hero = spawnHero(world);
    const locked = world.execute(hero.id, { kind: 'skill', skill: 'inferno', target: null });
    assert.match(locked.ok ? '' : locked.error, /unlocks at level 4/);
    hero.progress.level = 4;
    const cold = world.execute(hero.id, { kind: 'skill', skill: 'inferno', target: null });
    assert.match(cold.ok ? '' : cold.error, /Not enough Heat/);
  });

  it('rewards the killer with gold, experience and story progress', () => {
    const world = makeWorld();
    const hero = spawnHero(world);
    hero.progress.story.main.state = 'active';
    const puffcap = monsterOf(world, 'puffcap');
    standNextTo(hero, puffcap);
    puffcap.hp = 1;

    assert.ok(world.execute(hero.id, { kind: 'skill', skill: 'slash', target: puffcap.id }).ok);

    assert.equal(puffcap.alive, false);
    assert.ok(hero.progress.gold > 0);
    assert.ok(hero.progress.xp > 0 || hero.progress.level > 1);
    assert.equal(hero.progress.story.main.progress, 1);
    assert.ok(hero.progressDirty);
  });

  it('Healing Tonic restores health and is consumed, for every class', () => {
    const world = makeWorld();
    const hero = spawnHero(world, 'Thirsty', 1, 'warden');
    hero.hp = 10;
    const tonics = hero.progress.tonics;
    assert.ok(world.execute(hero.id, { kind: 'skill', skill: 'tonic', target: null }).ok);
    assert.ok(hero.hp > 10);
    assert.equal(hero.progress.tonics, tonics - 1);
  });
});
