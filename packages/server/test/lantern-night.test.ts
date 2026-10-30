import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BOUNTY_MARKS, SIEGE, SIM_DT, WAVES, lanternMaxHp } from '@lanternwood/shared';
import { GameWorld } from '../src/application/game-world';
import type { Player } from '../src/domain/entities/player';
import { FakeCalendar, constantRandom, runTicks, sharedRealm, spawnHero, standNextTo } from './support';

const makeWorld = (dayLengthSeconds = 480, startTimeOfDay = 0.33) =>
  new GameWorld({ generated: sharedRealm(), rng: constantRandom(0.3), dayLengthSeconds, startTimeOfDay, calendar: new FakeCalendar() });

const siegeMonsters = (world: GameWorld) => [...world.monsters()].filter((m) => m.goal !== null);
const seconds = (world: GameWorld, s: number) => runTicks(world, Math.round(s / SIM_DT));

/** Defeats every live siege monster with the hero's sword, the knight last. */
function clearWave(world: GameWorld, hero: Player): void {
  const monsters = siegeMonsters(world).filter((m) => m.alive).sort((a) => (a.type === 'gloomknight' ? 1 : -1));
  for (const m of monsters) {
    standNextTo(hero, m);
    m.hp = 1;
    hero.cooldowns.clear();
    hero.lastAttackAt = -100;
    world.execute(hero.id, { kind: 'skill', skill: 'slash', target: m.id });
  }
}

const atFountain = (hero: Player): void => void Object.assign(hero.body, { x: 0, y: 12.55, z: 6 });

describe('Lantern Night', () => {
  it('needs someone online, then warns everyone before the first wave', () => {
    const world = makeWorld();
    assert.equal(world.lanternNight.ringBell(), false, 'nobody to defend');
    const hero = spawnHero(world, 'Watch', 5);
    assert.ok(world.lanternNight.ringBell());
    assert.equal(world.siegeStatus()?.phase, 'warning');
    assert.equal(world.siegeStatus()?.lanternMax, lanternMaxHp(1));
    assert.equal(world.lanternNight.ringBell(), false, 'one siege at a time');
    assert.ok(world.drainEvents().some((r) => r.scope === 'player' && r.playerId === hero.id && r.event.e === 'banner'));
    seconds(world, SIEGE.warningSeconds + 0.1);
    assert.equal(world.siegeStatus()?.phase, 'wave');
    const monsters = siegeMonsters(world);
    assert.ok(monsters.length >= 6, `${monsters.length} monsters`);
    const gates = sharedRealm().siegeGates;
    for (const m of monsters) assert.ok(gates.some((g) => Math.hypot(g.x - m.x, g.z - m.z) < 5), 'they come in at the road gates');
    assert.ok(monsters.every((m) => m.type === 'wisp' && m.goalOnly && m.transient));
  });

  it('lets wisps that reach the fountain wear the Lantern down, and a dark Lantern loses the night', () => {
    const world = makeWorld(480, SIEGE.dusk + 0.01);
    const hero = spawnHero(world, 'Absent', 5);
    Object.assign(hero.body, { x: 0, y: 30, z: -60 });
    hero.progress.story.bell = { step: 4, progress: 0, state: 'active' };
    world.lanternNight.ringBell();
    seconds(world, SIEGE.warningSeconds + 15);
    const hurt = world.siegeStatus()!;
    assert.ok(hurt.lantern < hurt.lanternMax, `lantern ${hurt.lantern} of ${hurt.lanternMax}`);
    for (let i = 0; i < 200 && world.siegeStatus()?.phase !== 'lost'; i++) seconds(world, 5);
    assert.equal(world.siegeStatus()?.phase, 'lost');
    assert.equal(siegeMonsters(world).length, 0, 'the Gloom withdraws');
    assert.equal(hero.progress.story.bell.state, 'active', 'never at the fountain, so it does not count');
  });

  it('pays every defender when the Gloom Knight falls, and moves their stories on', () => {
    const world = makeWorld();
    const hero = spawnHero(world, 'Defender', 7);
    hero.progress.story.bell = { step: 4, progress: 0, state: 'active' };
    hero.progress.story.thief = { step: 5, progress: 0, state: 'active' };
    world.lanternNight.ringBell();
    seconds(world, SIEGE.warningSeconds + 0.1);
    for (let wave = 1; wave <= WAVES.length; wave++) {
      atFountain(hero);
      world.step(SIM_DT);
      assert.equal(world.siegeStatus()?.wave, wave);
      clearWave(world, hero);
      world.step(SIM_DT);
      if (wave < WAVES.length) {
        assert.equal(world.siegeStatus()?.phase, 'break');
        seconds(world, SIEGE.breakSeconds + 0.1);
      }
    }
    assert.equal(world.siegeStatus()?.phase, 'won');
    assert.equal(hero.progress.marks, SIEGE.winMarks + SIEGE.topDamageMarks + BOUNTY_MARKS, 'the win, top damage, and the Defend bounty');
    assert.equal(hero.progress.records.nightsWon, 1);
    assert.ok(hero.blessedUntil > world.time);
    assert.equal(hero.progress.story.bell.state, 'ready', 'When the Bell Rings: defended');
    assert.equal(hero.progress.story.thief.state, 'ready', 'Catch the Thief: the Knight is down');
    seconds(world, 13);
    assert.equal(world.siegeStatus(), null, 'the result clears');
  });

  it('gives the Gloom Steed on the fifth win', () => {
    const world = makeWorld();
    const hero = spawnHero(world, 'Veteran', 9);
    hero.progress.records.nightsWon = 4;
    world.lanternNight.ringBell();
    seconds(world, SIEGE.warningSeconds + 0.1);
    for (let wave = 1; wave <= WAVES.length; wave++) {
      atFountain(hero);
      world.step(SIM_DT);
      clearWave(world, hero);
      world.step(SIM_DT);
      if (wave < WAVES.length) seconds(world, SIEGE.breakSeconds + 0.1);
    }
    assert.ok(hero.progress.mounts.includes('steed'));
  });

  it('rings the Night Bell on every third dusk', () => {
    const world = makeWorld(20, 0.5);
    spawnHero(world, 'Nightwatch', 3);
    seconds(world, 20 * 0.3);
    assert.equal(world.siegeStatus(), null, 'first dusk');
    seconds(world, 20);
    assert.equal(world.siegeStatus(), null, 'second dusk');
    seconds(world, 20);
    assert.equal(world.siegeStatus()?.phase, 'warning', 'third dusk');
  });

  it('throttles Lantern updates but sends phase changes at once', () => {
    const world = makeWorld();
    spawnHero(world, 'Herald', 5);
    world.lanternNight.ringBell();
    assert.equal(world.takeSiegeUpdate()?.phase, 'warning');
    assert.equal(world.takeSiegeUpdate(), undefined, 'nothing new');
  });

  it('removes the Gloom’s bodies after their death animation', () => {
    const world = makeWorld();
    const hero = spawnHero(world, 'Sweeper', 6);
    world.lanternNight.ringBell();
    seconds(world, SIEGE.warningSeconds + 0.1);
    const before = siegeMonsters(world).length;
    clearWave(world, hero);
    seconds(world, 2);
    assert.ok(before > 0);
    assert.equal(siegeMonsters(world).length, 0);
  });
});
