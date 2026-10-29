import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { RIFT, RIFT_WAVES, SIM_DT, findNpc, type ModeState } from '@lanternwood/shared';
import { GameWorld } from '../src/application/game-world';
import { Leaderboards } from '../src/application/leaderboards';
import { nullLogger } from '../src/application/ports';
import type { Player } from '../src/domain/entities/player';
import { InMemoryLeaderboardRepository } from '../src/infrastructure/persistence/in-memory-leaderboard-repository';
import { FakeCalendar, constantRandom, runTicks, sharedRealm, spawnHero, standNextTo } from './support';

const makeWorld = () => {
  const boards = new Leaderboards(new InMemoryLeaderboardRepository(), nullLogger);
  const world = new GameWorld({ generated: sharedRealm(), rng: constantRandom(0.4), dayLengthSeconds: 480, calendar: new FakeCalendar(), boards });
  return { world, boards };
};
const seconds = (world: GameWorld, s: number) => runTicks(world, Math.round(s / SIM_DT));
const inCircle = (p: Player, offset = 0): void => void Object.assign(p.body, { x: RIFT.circle.x + offset, y: 12.55, z: RIFT.circle.z });
const rift = (world: GameWorld, p: Player): Extract<ModeState, { kind: 'rift' }> | null => {
  const s = world.modeStatus(p);
  return s?.kind === 'rift' ? s : null;
};

function open(world: GameWorld, opener: Player): void {
  const ilka = findNpc(world.npcs, 'ilka')!;
  Object.assign(opener.body, { x: ilka.x - 1, z: ilka.z });
  assert.ok(world.execute(opener.id, { kind: 'npc', npc: 'ilka', action: 'rift', arg: null }).ok);
  inCircle(opener);
}

/** Kills every rift monster of this party with the heroes' swords. */
function clearWave(world: GameWorld, hero: Player): void {
  for (const m of [...world.monsters()].filter((x) => x.party === hero.party && x.alive)) {
    standNextTo(hero, m);
    m.hp = 1;
    hero.cooldowns.strike = 0;
    world.execute(hero.id, { kind: 'skill', skill: 'strike', target: m.id });
  }
}

describe('Rift Trials', () => {
  it('takes everyone standing in the circle, and nobody else, to a rift island', () => {
    const { world } = makeWorld();
    const aria = spawnHero(world, 'Aria', 8);
    const bram = spawnHero(world, 'Bram', 7);
    const cass = spawnHero(world, 'Cass', 9);
    const low = spawnHero(world, 'Newbie', 3);
    assert.equal(world.execute(low.id, { kind: 'npc', npc: 'ilka', action: 'rift', arg: null }).ok, false);
    open(world, aria);
    assert.equal(rift(world, aria)?.phase, 'gathering');
    inCircle(bram, 1);
    inCircle(low, -1);
    Object.assign(cass.body, { x: 0, z: 0 });
    seconds(world, RIFT.gatherSeconds + 0.1);
    const arena = sharedRealm().riftArenas[0]!;
    for (const p of [aria, bram]) {
      assert.ok(Math.hypot(p.body.x - arena.x, p.body.z - arena.z) < 3, `${p.name} is on the island`);
      assert.notEqual(p.party, null);
    }
    assert.equal(aria.party, bram.party);
    assert.equal(cass.party, null);
    assert.equal(low.party, null, 'too low to go');
    assert.deepEqual(rift(world, aria)?.party, ['Aria', 'Bram']);
  });

  it('keeps rift monsters to their own party', () => {
    const { world } = makeWorld();
    const hero = spawnHero(world, 'Insider', 8);
    const outsider = spawnHero(world, 'Outsider', 8);
    open(world, hero);
    seconds(world, RIFT.gatherSeconds + RIFT.startSeconds + 0.2);
    const m = [...world.monsters()].find((x) => x.party === hero.party)!;
    assert.ok(m, 'wave 1 is up');
    standNextTo(outsider, m);
    outsider.lastAttackAt = -100;
    world.execute(outsider.id, { kind: 'skill', skill: 'strike', target: m.id });
    assert.equal(m.hp, m.maxHp, 'an outsider cannot hit it');
    seconds(world, 3);
    assert.equal(outsider.hp, outsider.maxHp, 'and it does not attack outsiders');
  });

  it('runs five waves to the Rift Lord, who calls wisps, then scores and pays the party', () => {
    const { world, boards } = makeWorld();
    const hero = spawnHero(world, 'Delver', 10);
    hero.progress.story.rift = { step: 4, progress: 0, state: 'active' };
    open(world, hero);
    seconds(world, RIFT.gatherSeconds + RIFT.startSeconds + 0.2);
    for (let wave = 1; wave <= RIFT_WAVES.length; wave++) {
      assert.equal(rift(world, hero)?.wave, wave);
      if (wave === RIFT_WAVES.length) {
        const lord = [...world.monsters()].find((x) => x.type === 'riftlord')!;
        standNextTo(hero, lord);
        lord.hp = lord.maxHp * 0.5;
        hero.cooldowns.strike = 0;
        world.execute(hero.id, { kind: 'skill', skill: 'strike', target: lord.id });
        assert.ok([...world.monsters()].some((x) => x.type === 'wisp' && x.party === hero.party), 'the Lord called wisps');
      }
      clearWave(world, hero);
      world.step(SIM_DT);
      if (wave < RIFT_WAVES.length) seconds(world, RIFT.breakSeconds + 0.1);
    }
    const done = rift(world, hero)!;
    assert.equal(done.phase, 'done');
    assert.ok(done.score >= RIFT_WAVES.length * RIFT.pointsPerWave);
    assert.equal(hero.progress.records.riftBest, done.score);
    assert.ok(hero.progress.pets.some((p) => p.id === 'mote'), 'first Rift Lord: the Rift Mote');
    assert.equal(hero.progress.story.rift.state, 'ready', 'Into the Rift: reached wave 3');
    assert.equal(boards.snapshot().find((b) => b.id === 'rift')?.entries[0]?.value, done.score);
    seconds(world, RIFT.endSeconds + 0.1);
    assert.equal(world.modeStatus(hero), null);
    assert.equal(hero.party, null);
    assert.ok(Math.hypot(hero.body.x, hero.body.z) < 10, 'home in Emberhold');
  });

  it('counts knock-outs, and fails when nobody is left', () => {
    const { world } = makeWorld();
    const hero = spawnHero(world, 'Fragile', 8);
    open(world, hero);
    seconds(world, RIFT.gatherSeconds + RIFT.startSeconds + 0.2);
    clearWave(world, hero);
    world.step(SIM_DT);
    hero.dead = true;
    world.step(SIM_DT);
    assert.equal(hero.party, null);
    assert.equal(world.modeStatus(hero), null);
    assert.equal(hero.progress.marks, 0, 'one wave cleared earns no Marks');
  });

  it('refuses mounts in the rift and lets a hero leave', () => {
    const { world } = makeWorld();
    const hero = spawnHero(world, 'Leaver', 8);
    hero.progress.mounts.push('strider');
    hero.progress.mount = 'strider';
    open(world, hero);
    seconds(world, RIFT.gatherSeconds + 0.1);
    assert.equal(world.execute(hero.id, { kind: 'mount', on: true }).ok, false);
    assert.ok(world.execute(hero.id, { kind: 'quit' }).ok);
    assert.equal(hero.party, null);
    assert.ok(Math.hypot(hero.body.x, hero.body.z) < 10);
  });

  it('says so when all four islands are in use', () => {
    const { world } = makeWorld();
    const parties: Player[] = [];
    for (let i = 0; i < 4; i++) {
      const hero = spawnHero(world, `Party${i}`, 8);
      parties.push(hero);
      open(world, hero);
      seconds(world, RIFT.gatherSeconds + 0.1);
      // Keep every party alive so their islands stay taken.
      for (const p of parties) p.hp = 1e9;
      assert.notEqual(hero.party, null);
    }
    const late = spawnHero(world, 'Late', 8);
    const ilka = findNpc(world.npcs, 'ilka')!;
    Object.assign(late.body, { x: ilka.x - 1, z: ilka.z });
    const result = world.execute(late.id, { kind: 'npc', npc: 'ilka', action: 'rift', arg: null });
    assert.equal(result.ok, false);
  });
});
