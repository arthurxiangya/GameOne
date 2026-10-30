import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DUEL, SIM_DT, bountiesForDay, classMaxHp, eloAfter, type InputFrame } from '@lanternwood/shared';
import { GameWorld } from '../src/application/game-world';
import { Leaderboards } from '../src/application/leaderboards';
import { nullLogger } from '../src/application/ports';
import type { Player } from '../src/domain/entities/player';
import { InMemoryLeaderboardRepository } from '../src/infrastructure/persistence/in-memory-leaderboard-repository';
import { FakeCalendar, constantRandom, monsterOf, runTicks, sharedRealm, spawnHero, standNextTo } from './support';

const makeWorld = (options: { duels?: boolean; day?: number } = {}) => {
  const boards = new Leaderboards(new InMemoryLeaderboardRepository(), nullLogger);
  const world = new GameWorld({
    generated: sharedRealm(), rng: constantRandom(0.5), dayLengthSeconds: 480, calendar: new FakeCalendar(options.day), boards, duels: options.duels,
  });
  return { world, boards };
};
const seconds = (world: GameWorld, s: number) => runTicks(world, Math.round(s / SIM_DT));
const place = (p: Player, x: number, z: number): void => void Object.assign(p.body, { x, y: 12.55, z, vx: 0, vy: 0, vz: 0 });

function startDuel(world: GameWorld, a: Player, b: Player): void {
  place(a, 0, 6);
  place(b, 2, 6);
  assert.ok(world.execute(a.id, { kind: 'duel', action: 'challenge', target: b.id }).ok);
  assert.equal(world.modeStatus(b)?.kind === 'duel' && world.modeStatus(b)?.phase, 'invited');
  assert.ok(world.execute(b.id, { kind: 'duel', action: 'accept' }).ok);
}

const swing = (world: GameWorld, p: Player) => {
  p.cooldowns.clear();
  return world.execute(p.id, { kind: 'skill', skill: 'slash', target: null });
};

describe('Duel Ring', () => {
  it('counts down with both heroes still, then lets them hit only each other, at the lower level', () => {
    const { world } = makeWorld();
    const strong = spawnHero(world, 'Strong', 15);
    const weak = spawnHero(world, 'Weak', 4);
    startDuel(world, strong, weak);
    assert.equal(strong.maxHp, classMaxHp('emberblade', 4, null), 'level-matched');
    assert.equal(swing(world, strong).ok, false, 'no hitting during the countdown');
    const frame: InputFrame = { seq: 1, fwd: 1, strafe: 0, yaw: 0, jump: false, swim: false };
    world.queueInput(weak.id, [frame]);
    const before = { ...weak.body };
    world.step(SIM_DT);
    assert.ok(Math.abs(weak.body.x - before.x) < 1e-9 && Math.abs(weak.body.z - before.z) < 1e-9, 'frozen');
    seconds(world, DUEL.countdownSeconds);
    assert.equal(world.modeStatus(strong)?.kind === 'duel' && world.modeStatus(strong)?.phase, 'fight');
    assert.ok(swing(world, strong).ok);
    assert.ok(weak.hp < weak.maxHp, 'the opponent took the hit');
    weak.hp = 10;
    assert.equal(world.execute(weak.id, { kind: 'skill', skill: 'tonic', target: null }).ok, false, 'no tonics');
  });

  it('ends when a hero would drop: they yield at 1 health, ratings move and both are healed', () => {
    const { world, boards } = makeWorld();
    const a = spawnHero(world, 'Victor', 8);
    const b = spawnHero(world, 'Valiant', 8);
    startDuel(world, a, b);
    seconds(world, DUEL.countdownSeconds + 0.1);
    b.hp = 1;
    swing(world, a);
    assert.equal(world.modeStatus(a), null);
    assert.equal(b.dead, false, 'nobody dies in a duel');
    assert.equal(b.hp, b.maxHp, 'healed afterwards');
    const expected = eloAfter(1000, 1000, 'win');
    assert.equal(a.progress.records.rating, expected.a);
    assert.equal(b.progress.records.rating, expected.b);
    assert.equal(a.progress.records.duelWins, 1);
    assert.equal(b.progress.records.duelLosses, 1);
    assert.equal(a.duelLevel, null);
    assert.equal(boards.snapshot().find((x) => x.id === 'duel')?.entries[0]?.name, 'Victor');
  });

  it('forfeits a hero who steps out of the ring, and judges by health share at the bell', () => {
    const { world } = makeWorld();
    const a = spawnHero(world, 'Runner', 6);
    const b = spawnHero(world, 'Stayer', 6);
    startDuel(world, a, b);
    seconds(world, DUEL.countdownSeconds + 0.1);
    place(a, 0, 6 + DUEL.ringRadius + 2);
    world.step(SIM_DT);
    assert.equal(b.progress.records.duelWins, 1);

    startDuel(world, a, b);
    seconds(world, DUEL.countdownSeconds + 0.1);
    a.hp = a.maxHp * 0.5;
    a.lastHurtAt = world.time + 1000; // no regeneration while the clock runs out
    seconds(world, DUEL.fightSeconds + 0.1);
    assert.equal(b.progress.records.duelWins, 2, 'more health left wins on time');
  });

  it('keeps monsters off duelists, and duelists off monsters', () => {
    const { world } = makeWorld();
    const a = spawnHero(world, 'Focus', 6);
    const b = spawnHero(world, 'Steady', 6);
    startDuel(world, a, b);
    seconds(world, DUEL.countdownSeconds + 0.1);
    const puff = monsterOf(world, 'puffcap');
    standNextTo(a, puff);
    swing(world, a);
    assert.equal(puff.hp, puff.maxHp, 'a duelist only hits their opponent');
    assert.ok(world.ignoredByMonsters(a));
  });

  it('can be declined, expires, and is refused in single-player and during Lantern Night', () => {
    const { world } = makeWorld();
    const a = spawnHero(world, 'Asker', 6);
    const b = spawnHero(world, 'Busy', 6);
    place(a, 0, 6);
    place(b, 30, 30);
    assert.equal(world.execute(a.id, { kind: 'duel', action: 'challenge', target: b.id }).ok, false, 'too far away');
    place(b, 2, 6);
    assert.ok(world.execute(a.id, { kind: 'duel', action: 'challenge', target: b.id }).ok);
    assert.ok(world.execute(b.id, { kind: 'duel', action: 'decline' }).ok);
    assert.equal(world.modeStatus(a), null);
    assert.ok(world.execute(a.id, { kind: 'duel', action: 'challenge', target: b.id }).ok);
    seconds(world, DUEL.inviteSeconds + 0.1);
    assert.equal(world.modeStatus(b), null, 'unanswered challenges expire');

    world.lanternNight.ringBell();
    assert.equal(world.execute(a.id, { kind: 'duel', action: 'challenge', target: b.id }).ok, false);

    const solo = makeWorld({ duels: false }).world;
    const s1 = spawnHero(solo, 'Alone', 6);
    const s2 = spawnHero(solo, 'Ghost', 6);
    place(s1, 0, 6);
    place(s2, 2, 6);
    assert.equal(solo.execute(s1.id, { kind: 'duel', action: 'challenge', target: s2.id }).ok, false);
  });

  it('counts for the Spar bounty', () => {
    let day = 20_000;
    while (!bountiesForDay(sharedRealm().seed, day, { duels: true }).includes('spar')) day++;
    const { world } = makeWorld({ day });
    const a = spawnHero(world, 'Sparrer', 6);
    const b = spawnHero(world, 'Partner', 6);
    const index = a.progress.bounties.ids.indexOf('spar');
    startDuel(world, a, b);
    seconds(world, DUEL.countdownSeconds + 0.1);
    b.hp = 1;
    swing(world, a);
    assert.equal(a.progress.bounties.done[index], true);
    assert.equal(b.progress.bounties.done[index], true, 'win or lose');
  });
});
