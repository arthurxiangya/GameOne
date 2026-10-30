import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CLASSES, TALENT_LEVELS, classMaxHp } from '@lanternwood/shared';
import type { GameWorld } from '../src/application/game-world';
import type { Player } from '../src/domain/entities/player';
import { newPlayerRecord, parsePlayerRecord, progressFromRecord, recordFromPlayer } from '../src/domain/player-record';
import { makeWorld, runTicks, spawnHero } from './support';

const pick = (world: GameWorld, p: Player, row: number, choice: number | null) => world.execute(p.id, { kind: 'talent', row, pick: choice });
const use = (world: GameWorld, p: Player, skill: string, target: number | null) => world.execute(p.id, { kind: 'skill', skill: skill as never, target });

function plaza(p: Player): void {
  Object.assign(p.body, { x: 0, z: 12, vx: 0, vy: 0, vz: 0 });
}

describe('talents', () => {
  it('opens rows by level, picks out of combat, and changes the skill bar', () => {
    const world = makeWorld();
    const hero = spawnHero(world, 'Picker', 7, 'emberblade');
    assert.ok(pick(world, hero, 0, 2).ok, 'row 1 opens at level 5');
    assert.equal(hero.progress.talents.emberblade?.[0], 'cleave');
    assert.equal(hero.kit[0]!.radius, 2, 'Cleave gives Slash a splash radius');
    const locked = pick(world, hero, 1, 0);
    assert.match(locked.ok ? '' : locked.error, /level 8/);
    plaza(hero);
    const boar = world.spawnMonster('boar', 7, 2.2, 12, { maxHp: 1e6, damage: 0 });
    assert.ok(use(world, hero, 'slash', boar.id).ok);
    const fighting = pick(world, hero, 0, 0);
    assert.match(fighting.ok ? '' : fighting.error, /fighting/);
    hero.lastAttackAt = -100;
    hero.lastHurtAt = -100;
    assert.ok(pick(world, hero, 0, null).ok);
    assert.equal(hero.kit[0]!.radius, 0);
  });

  it('splashes only a share of a basic attack onto everything near the target', () => {
    const world = makeWorld();
    const hero = spawnHero(world, 'Cleaver', 5, 'emberblade');
    hero.progress.talents.emberblade = ['cleave', null, null, null];
    plaza(hero);
    const main = world.spawnMonster('boar', 5, 2.2, 12, { maxHp: 1e6, damage: 0 });
    const side = world.spawnMonster('boar', 5, 2.2, 13.5, { maxHp: 1e6, damage: 0 });
    world.step(0.05); // spawned monsters join the spatial grid at the end of a tick
    assert.ok(use(world, hero, 'slash', main.id).ok);
    const ratio = (side.maxHp - side.hp) / (main.maxHp - main.hp);
    assert.ok(Math.abs(ratio - 0.15) < 0.02, `splash ${ratio.toFixed(3)}`);
  });

  it('guards a hero below 35% health, heals on kills, and hastens cooldowns', () => {
    const world = makeWorld();
    const warden = spawnHero(world, 'Guard', 20, 'warden');
    warden.progress.talents.warden = [null, 'lastStand', null, null];
    plaza(warden);
    const boar = world.spawnMonster('boar', 20, 2.2, 12, { huntRange: 12, damage: 100 });
    const hit = (hpShare: number) => {
      warden.hp = Math.round(warden.maxHp * hpShare);
      const before = warden.hp;
      for (let i = 0; i < 80 && warden.hp === before; i++) world.step(0.05);
      return before - warden.hp;
    };
    assert.equal(hit(1), 75, 'armour only above 35%');
    assert.equal(hit(0.3), 60, 'Last Stand takes 20% more off below 35%');
    boar.die();

    const ranger = spawnHero(world, 'Dresser', 20, 'ranger');
    ranger.progress.talents.ranger = [null, 'fieldDressing', null, null];
    plaza(ranger);
    const prey = world.spawnMonster('boar', 20, 4, 12, { damage: 0 });
    prey.hp = 1;
    ranger.hp = 100;
    assert.ok(use(world, ranger, 'quickShot', prey.id).ok);
    runTicks(world, 20);
    assert.equal(prey.alive, false);
    assert.ok(ranger.hp >= 100 + Math.round(ranger.maxHp * 0.05) - 1, 'Field Dressing healed 5% on the kill');

    const chimer = spawnHero(world, 'Tempo', 20, 'chimer');
    chimer.progress.talents.chimer = [null, 'tempo', null, null];
    chimer.cooldowns.set('peal', 16);
    runTicks(world, 20);
    assert.ok(Math.abs(chimer.cooldown('peal') - (16 - 1.1)) < 0.01, `Tempo: ${chimer.cooldown('peal')}`);
  });

  it('weakens a monster’s blows with Choking Smoke', () => {
    const world = makeWorld();
    const blade = spawnHero(world, 'Smoker', 20, 'emberblade');
    blade.progress.talents.emberblade = [null, null, null, 'smoke'];
    plaza(blade);
    const boar = world.spawnMonster('boar', 20, 2.2, 12, { huntRange: 12, maxHp: 1e6, damage: 100 });
    const hit = () => {
      blade.hp = blade.maxHp;
      for (let i = 0; i < 80 && blade.hp === blade.maxHp; i++) world.step(0.05);
      return blade.maxHp - blade.hp;
    };
    const plain = hit();
    blade.mp = 100;
    assert.ok(use(world, blade, 'inferno', null).ok);
    assert.ok(boar.statuses.has('smoke', world.time));
    const choked = hit();
    assert.ok(Math.abs(choked / plain - 0.8) < 0.02, `${choked} vs ${plain}`);
  });

  it('counts specs and talents at the duel level, so a lower hero’s opponent loses the rows they lack', () => {
    const world = makeWorld();
    const hero = spawnHero(world, 'Veteran', 20, 'warden');
    hero.progress.specs.warden = 'bulwark';
    hero.progress.talents.warden = ['heavyBash', 'lastStand', 'heavySlam', 'mendingShout'];
    assert.equal(hero.talents.length, 4);
    assert.equal(hero.spec?.id, 'bulwark');
    hero.duelLevel = 9;
    assert.equal(hero.spec, null, 'no spec below level 10');
    assert.deepEqual(hero.talents.map((t) => t.id), ['heavyBash', 'lastStand'], 'rows at levels 5 and 8 only');
    assert.equal(hero.maxHp, classMaxHp('warden', 9, null));
  });

  it('saves picks per class and drops talents that are in the wrong row or class', () => {
    const world = makeWorld();
    const base = newPlayerRecord('acc', 'Saver', 'now');
    const hero = world.spawnPlayer('acc', 0, progressFromRecord({ ...base, cls: 'chimer', talents: { chimer: ['echo', null, 'anthem', 'dissonance'] } }));
    const saved = JSON.parse(JSON.stringify(recordFromPlayer(base, hero, 'later')));
    const loaded = parsePlayerRecord(saved)!;
    assert.deepEqual(loaded.talents.chimer, ['echo', null, null, 'dissonance'], 'Anthem belongs in row 4, not row 3');
    const damaged = parsePlayerRecord({ ...saved, talents: { chimer: ['cleave', 7], warden: 'x' } })!;
    assert.deepEqual(damaged.talents, { chimer: [null, null, null, null] });
  });

  it('gives every class four rows of three, opening at 5, 8, 15 and 18, all pickable at level 20', () => {
    assert.deepEqual([...TALENT_LEVELS], [5, 8, 15, 18]);
    for (const cls of Object.keys(CLASSES) as (keyof typeof CLASSES)[]) {
      const world = makeWorld();
      const hero = spawnHero(world, 'Rows', 20, cls);
      for (let row = 0; row < 4; row++) {
        for (let choice = 0; choice < 3; choice++) assert.ok(pick(world, hero, row, choice).ok, `${cls} row ${row + 1} option ${choice + 1}`);
      }
      assert.equal(hero.talents.length, 4);
    }
  });
});
