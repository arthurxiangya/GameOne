import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { RACE_COUNTDOWN, SIM_DT, bountiesForDay, coursePoints, findNpc, placeOnBoard, type InputFrame, type StoredEntry } from '@lanternwood/shared';
import { GameWorld } from '../src/application/game-world';
import { Leaderboards } from '../src/application/leaderboards';
import { nullLogger } from '../src/application/ports';
import type { Player } from '../src/domain/entities/player';
import { parseBoards } from '../src/domain/leaderboard-record';
import { InMemoryLeaderboardRepository } from '../src/infrastructure/persistence/in-memory-leaderboard-repository';
import { FakeCalendar, constantRandom, monsterOf, runTicks, sharedRealm, spawnHero, standAt, standNextTo } from './support';

const makeRaceWorld = (calendar = new FakeCalendar()) => {
  const boards = new Leaderboards(new InMemoryLeaderboardRepository(), nullLogger);
  const world = new GameWorld({ generated: sharedRealm(), rng: constantRandom(), dayLengthSeconds: 480, calendar, boards });
  return { world, boards, calendar };
};

const startRun = (world: GameWorld, hero: Player) => {
  standAt(hero, findNpc(world.npcs, 'pip')!);
  return world.execute(hero.id, { kind: 'npc', npc: 'pip', action: 'race', arg: null });
};

/** Moves the hero onto each remaining course point, spending `ticksPerLeg` ticks on each. */
function runCourse(world: GameWorld, hero: Player, ticksPerLeg: number, skip = -1): void {
  const points = coursePoints(world.raceCourse);
  for (let i = 1; i < points.length; i++) {
    if (i === skip) continue;
    runTicks(world, ticksPerLeg - 1);
    Object.assign(hero.body, { ...points[i]!, vx: 0, vy: 0, vz: 0 });
    world.step(SIM_DT);
  }
}

describe('Ember Run', () => {
  it('counts down without letting the runner move, then times the run through every checkpoint', () => {
    const { world, boards } = makeRaceWorld();
    const hero = spawnHero(world, 'Sprinter', 2);
    assert.ok(startRun(world, hero).ok);
    assert.equal(world.modeStatus(hero)?.phase, 'countdown');
    const start = { x: hero.body.x, z: hero.body.z };
    const forward = (seq: number): InputFrame => ({ seq, fwd: 1, strafe: 0, yaw: 0, jump: false, swim: false });
    world.queueInput(hero.id, Array.from({ length: 10 }, (_, i) => forward(i + 1)));
    runTicks(world, 10);
    assert.ok(Math.hypot(hero.body.x - start.x, hero.body.z - start.z) < 1e-6, 'frozen during the countdown');
    runTicks(world, Math.ceil(RACE_COUNTDOWN / SIM_DT));
    assert.equal(world.modeStatus(hero)?.phase, 'running');

    runCourse(world, hero, 20);
    assert.equal(world.modeStatus(hero), null, 'finished');
    const time = hero.progress.records.raceBest!;
    assert.ok(time > 8 && time < 10, `time ${time}`);
    assert.equal(hero.progress.marks, 2, 'a gold medal pays 2 Marks the first time each day');
    assert.equal(boards.snapshot().find((b) => b.id === 'race')?.entries[0]?.name, 'Sprinter');
    assert.ok(world.drainEvents().some((r) => r.event.e === 'banner'));
  });

  it('pays medal Marks once a day and keeps the best time', () => {
    const { world, calendar } = makeRaceWorld();
    const hero = spawnHero(world, 'Repeat', 2);
    for (const legs of [20, 10]) {
      assert.ok(startRun(world, hero).ok);
      runTicks(world, Math.ceil(RACE_COUNTDOWN / SIM_DT) + 1);
      runCourse(world, hero, legs);
    }
    assert.equal(hero.progress.marks, 2);
    assert.ok(hero.progress.records.raceBest! < 5);
    calendar.day += 1;
    assert.ok(startRun(world, hero).ok);
    runTicks(world, Math.ceil(RACE_COUNTDOWN / SIM_DT) + 1);
    runCourse(world, hero, 20);
    assert.equal(hero.progress.marks, 4, 'a new day, a new medal reward');
  });

  it('only counts checkpoints in order', () => {
    const { world } = makeRaceWorld();
    const hero = spawnHero(world, 'Cutter', 2);
    startRun(world, hero);
    runTicks(world, Math.ceil(RACE_COUNTDOWN / SIM_DT) + 1);
    runCourse(world, hero, 5, 3);
    const status = world.modeStatus(hero);
    assert.equal(status?.kind === 'race' && status.next, 3, 'still waiting for the skipped checkpoint');
    assert.equal(hero.progress.records.raceBest, null);
  });

  it('is on foot and peaceful: no attacks, no mounts, and monsters look away', () => {
    const { world } = makeRaceWorld();
    const hero = spawnHero(world, 'Pacifist', 6);
    hero.progress.mounts.push('strider');
    hero.progress.mount = 'strider';
    startRun(world, hero);
    hero.mp = 100;
    const inferno = world.execute(hero.id, { kind: 'skill', skill: 'inferno', target: null });
    assert.match(inferno.ok ? '' : inferno.error, /No fighting/);
    assert.equal(world.execute(hero.id, { kind: 'mount', on: true }).ok, false);
    hero.hp = 10;
    assert.ok(world.execute(hero.id, { kind: 'skill', skill: 'tonic', target: null }).ok, 'tonics still work');
    runTicks(world, Math.ceil(RACE_COUNTDOWN / SIM_DT) + 1);
    const boar = monsterOf(world, 'boar');
    standNextTo(hero, boar, 0.5);
    runTicks(world, 40);
    assert.equal(boar.mode === 'chase' && boar.targetId === hero.id, false);
  });

  it('ends when the runner gives up, falls off the world or is defeated', () => {
    const { world } = makeRaceWorld();
    const hero = spawnHero(world, 'Quitter', 2);
    startRun(world, hero);
    assert.ok(world.execute(hero.id, { kind: 'quit' }).ok);
    assert.equal(world.modeStatus(hero), null);
    assert.equal(world.execute(hero.id, { kind: 'quit' }).ok, false);

    startRun(world, hero);
    hero.body.y = -100;
    runTicks(world, 1);
    assert.equal(world.modeStatus(hero), null);

    startRun(world, hero);
    hero.dead = true;
    runTicks(world, 1);
    assert.equal(world.modeStatus(hero), null);
  });

  it('counts for the Run bounty', () => {
    let day = 20_000;
    while (!bountiesForDay(sharedRealm().seed, day, { duels: false }).includes('run')) day++;
    const { world } = makeRaceWorld(new FakeCalendar(day));
    const hero = spawnHero(world, 'Courier', 2);
    const index = hero.progress.bounties.ids.indexOf('run');
    startRun(world, hero);
    runTicks(world, Math.ceil(RACE_COUNTDOWN / SIM_DT) + 1);
    runCourse(world, hero, 200);
    assert.equal(hero.progress.bounties.done[index], true);
  });
});

describe('leaderboards', () => {
  const entry = (key: string, value: number, at = '2026-10-29'): StoredEntry => ({ key, name: `Hero ${key}`, value, at });

  it('keeps one place per hero, their best, sorted, at most ten', () => {
    let entries: StoredEntry[] = [];
    for (let i = 0; i < 14; i++) entries = placeOnBoard('race', entries, entry(`k${i}`, 100 + i)).entries;
    assert.equal(entries.length, 10);
    assert.equal(placeOnBoard('race', entries, entry('k3', 120)).place, null, 'a slower time does not replace a faster one');
    const better = placeOnBoard('race', entries, entry('k3', 50));
    assert.equal(better.place, 1);
    assert.equal(better.entries.filter((e) => e.key === 'k3').length, 1);
    assert.equal(placeOnBoard('rift', [entry('a', 10)], entry('b', 20)).place, 1, 'higher scores rank first on the rift board');
  });

  it('merges saved boards on load and never sends owner keys to clients', async () => {
    const repo = new InMemoryLeaderboardRepository();
    await repo.save({ race: [entry('old', 90)] });
    const boards = new Leaderboards(repo, nullLogger);
    boards.submit('race', entry('new', 80));
    await boards.load();
    const race = boards.snapshot().find((b) => b.id === 'race')!;
    assert.deepEqual(race.entries.map((e) => e.name), ['Hero new', 'Hero old']);
    assert.ok(race.entries.every((e) => !('key' in e)));
    await boards.flush();
    assert.equal((await repo.load()).race?.length, 2);
  });

  it('drops malformed saved entries', () => {
    const parsed = parseBoards({ race: [entry('a', 5), { key: 'b', name: '<>', value: 3 }, { key: 'c', name: 'Ok', value: 'fast' }], nonsense: [] });
    assert.deepEqual(parsed.race?.map((e) => e.key), ['a']);
  });
});
