import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { SKILLS } from '@lanternwood/shared';
import { makeWorld, monsterOf, runTicks, spawnHero, standNextTo } from './support';

describe('combat', () => {
  it('Strike damages a monster in reach, reports it, and starts the cooldown', () => {
    const world = makeWorld();
    const hero = spawnHero(world);
    const puffcap = monsterOf(world, 'puffcap');
    standNextTo(hero, puffcap);

    const result = world.execute(hero.id, { kind: 'skill', skill: 'strike', target: puffcap.id });

    assert.ok(result.ok);
    assert.ok(puffcap.hp < puffcap.maxHp);
    assert.equal(hero.cooldowns.strike, SKILLS.strike.cooldown);
    const events = world.drainEvents().map((r) => r.event);
    assert.ok(events.some((e) => e.e === 'dmg' && e.id === puffcap.id));
    assert.ok(events.some((e) => e.e === 'swing' && e.id === hero.id));
  });

  it('refuses a skill on cooldown and a target out of reach', () => {
    const world = makeWorld();
    const hero = spawnHero(world);
    const puffcap = monsterOf(world, 'puffcap');
    standNextTo(hero, puffcap);
    assert.ok(world.execute(hero.id, { kind: 'skill', skill: 'strike', target: puffcap.id }).ok);
    assert.equal(world.execute(hero.id, { kind: 'skill', skill: 'strike', target: puffcap.id }).ok, false);

    runTicks(world, 20);
    standNextTo(hero, puffcap, 8);
    const far = world.execute(hero.id, { kind: 'skill', skill: 'strike', target: puffcap.id });
    assert.equal(far.ok, false);
    assert.match(far.ok ? '' : far.error, /Too far/);
  });

  it('Ember Bolt costs mana and lands only after its flight time', () => {
    const world = makeWorld();
    const hero = spawnHero(world);
    const boar = monsterOf(world, 'boar');
    standNextTo(hero, boar, 10);
    const mpBefore = hero.mp;

    assert.ok(world.execute(hero.id, { kind: 'skill', skill: 'bolt', target: boar.id }).ok);
    assert.equal(hero.mp, mpBefore - SKILLS.bolt.mana);
    assert.equal(boar.hp, boar.maxHp, 'no damage before the bolt arrives');
    world.step(0.05);
    world.step(0.5);
    assert.ok(boar.hp < boar.maxHp);
  });

  it('locks skills until their unlock level', () => {
    const world = makeWorld();
    const hero = spawnHero(world);
    const r = world.execute(hero.id, { kind: 'skill', skill: 'ring', target: null });
    assert.equal(r.ok, false);
  });

  it('rewards the killer with gold, experience and story progress', () => {
    const world = makeWorld();
    const hero = spawnHero(world);
    hero.progress.story.main.state = 'active';
    const puffcap = monsterOf(world, 'puffcap');
    standNextTo(hero, puffcap);
    puffcap.hp = 1;

    assert.ok(world.execute(hero.id, { kind: 'skill', skill: 'strike', target: puffcap.id }).ok);

    assert.equal(puffcap.alive, false);
    assert.ok(hero.progress.gold > 0);
    assert.ok(hero.progress.xp > 0 || hero.progress.level > 1);
    assert.equal(hero.progress.story.main.progress, 1);
    assert.ok(hero.progressDirty);
  });

  it('Healing Tonic restores health and is consumed', () => {
    const world = makeWorld();
    const hero = spawnHero(world);
    hero.hp = 10;
    const tonics = hero.progress.tonics;
    assert.ok(world.execute(hero.id, { kind: 'skill', skill: 'tonic', target: null }).ok);
    assert.ok(hero.hp > 10);
    assert.equal(hero.progress.tonics, tonics - 1);
  });
});
