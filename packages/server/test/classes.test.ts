import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CLASSES, SPEC_LEVEL, classMaxHp } from '@lanternwood/shared';
import type { GameWorld } from '../src/application/game-world';
import type { Monster } from '../src/domain/entities/monster';
import type { Player } from '../src/domain/entities/player';
import { newPlayerRecord, parsePlayerRecord, progressFromRecord, recordFromPlayer } from '../src/domain/player-record';
import { makeWorld, runTicks, spawnHero } from './support';

/** A quiet spot on the plaza, and a monster to practise on. */
function arena(world: GameWorld, p: Player, opts: { damage?: number; maxHp?: number; type?: 'boar' | 'warden' } = {}): Monster {
  Object.assign(p.body, { x: 0, z: 12, vx: 0, vy: 0, vz: 0 });
  return world.spawnMonster(opts.type ?? 'boar', p.level, 2.2, 12, { huntRange: 12, damage: opts.damage ?? 0, maxHp: opts.maxHp ?? 1e6 });
}

const use = (world: GameWorld, p: Player, skill: string, target: number | null) =>
  world.execute(p.id, { kind: 'skill', skill: skill as never, target });

const seconds = (world: GameWorld, s: number) => runTicks(world, Math.round(s / 0.05));

/** Waits for the next real monster hit on the hero; returns the health it took. */
function takeHit(world: GameWorld, p: Player): number {
  p.hp = p.maxHp;
  for (let i = 0; i < 80; i++) {
    world.step(0.05);
    if (p.hp < p.maxHp) return p.maxHp - p.hp;
  }
  throw new Error('no hit landed');
}

describe('the Warden', () => {
  it('taunts a monster off an ally and builds Resolve from being hit', () => {
    const world = makeWorld();
    const ally = spawnHero(world, 'Squishy', 6, 'ranger');
    const warden = spawnHero(world, 'Wall', 6, 'warden');
    const boar = arena(world, ally, { damage: 5 });
    Object.assign(warden.body, { x: 3, z: 14 });
    boar.addThreat(ally.id, 500);
    boar.provoke();
    seconds(world, 0.2);
    assert.equal(boar.targetId, ally.id);
    assert.ok(use(world, warden, 'taunt', null).ok);
    seconds(world, 0.2);
    assert.equal(boar.targetId, warden.id, 'the taunt wins over 500 threat');
    const before = warden.mp;
    seconds(world, 3.5);
    assert.ok(warden.mp > before, 'Resolve rises as the boar hits');
  });

  it('Shield Wall cuts damage by 40% on top of armour; reductions stop at 60%', () => {
    const world = makeWorld();
    const warden = spawnHero(world, 'Wall', 6, 'warden');
    arena(world, warden, { damage: 100 });
    warden.mp = 100;
    const hit = () => takeHit(world, warden);
    assert.equal(hit(), 75, '25% armour');
    assert.ok(use(world, warden, 'shieldWall', null).ok);
    assert.equal(hit(), 45, 'armour and Shield Wall multiply');
    warden.statuses.apply({ id: 'bulwark', name: 'Bulwark', seconds: 5, damageTaken: -0.2 }, world.time, 0);
    assert.equal(hit(), 40, 'never more than 60% off');
  });
});

describe('the Lightkeeper', () => {
  it('Mend heals the hero you target, or you, and Lantern Ward soaks damage', () => {
    const world = makeWorld();
    const healer = spawnHero(world, 'Lamp', 6, 'lightkeeper');
    const friend = spawnHero(world, 'Friend', 6, 'emberblade');
    const boar = arena(world, healer, { damage: 50 });
    Object.assign(friend.body, { x: 4, z: 12 });
    friend.hp = 20;
    assert.ok(use(world, healer, 'mend', friend.id).ok);
    assert.equal(friend.hp, 20 + Math.round(healer.attack * 2.5));
    healer.hp = 20;
    healer.cooldowns.clear();
    assert.ok(use(world, healer, 'mend', boar.id).ok, 'a monster target heals yourself');
    assert.ok(healer.hp > 20);

    assert.ok(use(world, healer, 'ward', friend.id).ok);
    assert.equal(friend.shield, Math.round(healer.attack * 3));
    boar.threat.clear();
    boar.taunt(friend.id, world.time + 10);
    Object.assign(friend.body, { x: 0.5, z: 13 });
    const shield = friend.shield;
    friend.hp = friend.maxHp;
    for (let i = 0; i < 80 && friend.shield === shield; i++) world.step(0.05);
    assert.ok(friend.shield < shield, 'the ward soaked the hit');
    assert.equal(friend.hp, friend.maxHp, 'none of it got through');
    Object.assign(friend.body, { x: 60, z: 12 });
    healer.cooldowns.clear();
    const far = use(world, healer, 'mend', friend.id);
    assert.match(far.ok ? '' : far.error, /too far/);
  });
});

describe('the Ranger', () => {
  it('Pinning Shot slows, and Volley splashes around its target', () => {
    const world = makeWorld();
    const ranger = spawnHero(world, 'Bow', 6, 'ranger');
    const boar = arena(world, ranger);
    const other = world.spawnMonster('boar', 6, boar.x + 2, boar.z, { maxHp: 1e6, damage: 0 });
    assert.ok(use(world, ranger, 'pinningShot', boar.id).ok);
    seconds(world, 0.3);
    assert.equal(boar.statuses.slow(world.time), 0.5);
    assert.ok(use(world, ranger, 'volley', boar.id).ok);
    seconds(world, 0.3);
    assert.ok(other.hp < other.maxHp, 'the splash reached the second boar');
  });
});

describe('the Emberblade', () => {
  it('Searing Edge burns once a second for its whole duration, and Heat drains out of combat', () => {
    const world = makeWorld();
    const blade = spawnHero(world, 'Edge', 6, 'emberblade');
    const boar = arena(world, blade);
    assert.ok(use(world, blade, 'searingEdge', boar.id).ok);
    const afterHit = boar.hp;
    seconds(world, 4.2);
    const burned = afterHit - boar.hp;
    assert.ok(Math.abs(burned - blade.attack * 0.6) <= 4, `burn ${burned} vs ${blade.attack * 0.6}`);
    assert.equal(blade.mp, 10, 'Searing Edge builds 10 Heat');
    blade.lastAttackAt = -100;
    blade.lastHurtAt = -100;
    seconds(world, 1.5);
    assert.equal(blade.mp, 0, 'cooled down');
  });
});

describe('the Chimer', () => {
  it('Rallying Peal makes allies hit harder; Discord makes the target take more', () => {
    const world = makeWorld();
    const chimer = spawnHero(world, 'Bell', 6, 'chimer');
    const blade = spawnHero(world, 'Edge', 6, 'emberblade');
    const boar = arena(world, chimer);
    Object.assign(blade.body, { x: 1, z: 12 });
    const slashOnce = () => {
      blade.cooldowns.clear();
      const before = boar.hp;
      assert.ok(use(world, blade, 'slash', boar.id).ok);
      return before - boar.hp;
    };
    const plain = slashOnce();
    assert.ok(use(world, chimer, 'peal', null).ok);
    assert.ok(blade.statuses.has('peal', world.time));
    const rallied = slashOnce();
    assert.ok(Math.abs(rallied / plain - 1.15) < 0.02, `${rallied} vs ${plain}`);
    assert.ok(use(world, chimer, 'discord', boar.id).ok);
    seconds(world, 0.4);
    const both = slashOnce();
    assert.ok(Math.abs(both / plain - 1.15 * 1.2) < 0.03, `${both} vs ${plain}`);
  });

  it('Stillwater’s Discord stuns monsters but not bosses', () => {
    const world = makeWorld();
    const chimer = spawnHero(world, 'Still', SPEC_LEVEL, 'chimer');
    chimer.progress.specs.chimer = 'stillwater';
    const boar = arena(world, chimer);
    assert.ok(use(world, chimer, 'discord', boar.id).ok);
    seconds(world, 0.3);
    assert.ok(boar.statuses.stunned(world.time));
    const boss = world.spawnMonster('warden', SPEC_LEVEL, 0, 9, { maxHp: 1e6 });
    chimer.cooldowns.clear();
    assert.ok(use(world, chimer, 'discord', boss.id).ok);
    seconds(world, 0.3);
    assert.equal(boss.statuses.stunned(world.time), false);
  });
});

describe('changing class and specialization', () => {
  it('changes class in town out of combat, keeps the share of health, and remembers specs per class', () => {
    const world = makeWorld();
    const hero = spawnHero(world, 'Shifter', 12, 'warden');
    hero.hp = Math.round(hero.maxHp / 2);
    assert.ok(world.execute(hero.id, { kind: 'class', cls: 'warden', spec: 'bulwark' }).ok);
    assert.equal(hero.maxHp, classMaxHp('warden', 12, CLASSES.warden.specs[0]));
    assert.ok(world.execute(hero.id, { kind: 'class', cls: 'ranger', spec: null }).ok);
    assert.equal(hero.cls, 'ranger');
    assert.ok(Math.abs(hero.hp / hero.maxHp - 0.5) < 0.01);
    assert.equal(hero.mp, hero.maxMp, 'Focus starts full');
    assert.equal(hero.progress.specs.warden, 'bulwark', 'the Warden spec is remembered');
    assert.ok(hero.kit.every((s) => CLASSES.ranger.skills.some((r) => r.id === s.id)));
  });

  it('refuses mid-fight, away from Emberhold, or a spec before level 10', () => {
    const world = makeWorld();
    const hero = spawnHero(world, 'Busy', 6, 'emberblade');
    const boar = arena(world, hero);
    assert.ok(use(world, hero, 'slash', boar.id).ok);
    const fighting = world.execute(hero.id, { kind: 'class', cls: 'warden', spec: null });
    assert.match(fighting.ok ? '' : fighting.error, /fighting/);
    hero.lastAttackAt = -100;
    hero.lastHurtAt = -100;
    const early = world.execute(hero.id, { kind: 'class', cls: 'emberblade', spec: 'duelist' });
    assert.match(early.ok ? '' : early.error, /level 10/);
    Object.assign(hero.body, { x: 120, z: 120 });
    const away = world.execute(hero.id, { kind: 'class', cls: 'warden', spec: null });
    assert.match(away.ok ? '' : away.error, /Emberhold/);
  });

  it('saves the class and specs, and drops a spec that belongs to another class', () => {
    const world = makeWorld();
    const base = newPlayerRecord('acc', 'Saver', 'now');
    const hero = world.spawnPlayer('acc', 0, progressFromRecord({ ...base, cls: 'chimer', specs: { chimer: 'warbell' } }));
    const saved = JSON.parse(JSON.stringify(recordFromPlayer(base, hero, 'later')));
    const loaded = parsePlayerRecord(saved)!;
    assert.equal(loaded.cls, 'chimer');
    assert.deepEqual(loaded.specs, { chimer: 'warbell' });
    const damaged = parsePlayerRecord({ ...saved, cls: 'paladin', specs: { chimer: 'bulwark', ranger: 'trapper' } })!;
    assert.equal(damaged.cls, 'emberblade');
    assert.deepEqual(damaged.specs, { ranger: 'trapper' });
  });
});
