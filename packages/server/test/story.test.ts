import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ALL_BOUNTIES_MARKS,
  BOUNTY_MARKS,
  bountyGold,
  chainById,
  findNpc,
  newProgress,
  type NpcId,
} from '@lanternwood/shared';
import type { GameWorld } from '../src/application/game-world';
import type { Player } from '../src/domain/entities/player';
import { EventBuffer } from '../src/domain/events';
import { parsePlayerRecord, progressFromRecord, recordFromPlayer, newPlayerRecord } from '../src/domain/player-record';
import { BountyService } from '../src/domain/services/bounty-service';
import { ProgressionService } from '../src/domain/services/progression-service';
import { FakeCalendar, constantRandom, makeWorld, monsterOf, runTicks, spawnHero, standAt, standNextTo } from './support';

const talkTo = (world: GameWorld, hero: Player, npc: NpcId, action: 'accept' | 'talk' | 'turnIn', chain: string) => {
  standAt(hero, findNpc(world.npcs, npc)!);
  return world.execute(hero.id, { kind: 'npc', npc, action, arg: chain });
};

const defeat = (world: GameWorld, hero: Player, type: 'toad' | 'boar' | 'puffcap', index: number): void => {
  const m = monsterOf(world, type, index);
  standNextTo(hero, m);
  m.hp = 1;
  hero.cooldowns.strike = 0;
  assert.ok(world.execute(hero.id, { kind: 'skill', skill: 'strike', target: m.id }).ok);
};

const visit = (world: GameWorld, hero: Player, place: string): void => {
  const l = world.landmarks.find((x) => x.id === place)!;
  Object.assign(hero.body, { x: l.x, y: l.y, z: l.z });
  runTicks(world, 10);
};

describe('story chains', () => {
  it('plays The Drowned Bell from Tamsin’s request to the Bellfinder title', () => {
    const world = makeWorld(constantRandom(0.5));
    const hero = spawnHero(world, 'Bellhunter', 1);
    const story = hero.progress.story;

    assert.equal(talkTo(world, hero, 'tamsin', 'accept', 'bell').ok, false, 'locked below level 3');
    hero.progress.level = 3;
    assert.equal(talkTo(world, hero, 'maren', 'accept', 'bell').ok, false, 'only Tamsin gives it');
    assert.ok(talkTo(world, hero, 'tamsin', 'accept', 'bell').ok);
    assert.equal(story.bell.state, 'active');

    visit(world, hero, 'sunken-pier');
    assert.equal(story.bell.step, 1, 'finding the pier completes the first step on the spot');
    assert.equal(story.bell.state, 'active', 'the next step starts by itself');

    for (let i = 0; i < 4; i++) defeat(world, hero, 'toad', i);
    assert.equal(story.bell.step, 2);

    assert.equal(talkTo(world, hero, 'tamsin', 'talk', 'bell').ok, false, 'Maren is the one to ask');
    assert.ok(talkTo(world, hero, 'maren', 'talk', 'bell').ok);
    assert.equal(story.bell.step, 3);

    const marks = hero.progress.marks;
    assert.ok(talkTo(world, hero, 'tamsin', 'talk', 'bell').ok);
    assert.equal(story.bell.step, chainById('bell').steps.length);
    assert.equal(hero.progress.marks, marks + 2);
    assert.deepEqual(hero.progress.titles, ['bellfinder']);
    assert.equal(hero.progress.title, 'bellfinder', 'the first title earned is shown');
    assert.equal(talkTo(world, hero, 'tamsin', 'accept', 'bell').ok, false, 'a finished story stays finished');
    assert.ok(world.drainEvents().some((r) => r.event.e === 'story'));
  });

  it('only counts a collect objective when the item drops', () => {
    const world = makeWorld(constantRandom(0.9));
    const hero = spawnHero(world, 'Unlucky', 5);
    hero.progress.story.bell = { step: 1, progress: 0, state: 'active' };
    defeat(world, hero, 'toad', 0);
    assert.equal(hero.progress.story.bell.progress, 0);
  });

  it('asks for the turn-in at the right character', () => {
    const world = makeWorld();
    const hero = spawnHero(world, 'Turner', 2);
    hero.progress.story.main = { step: 0, progress: 6, state: 'ready' };
    assert.equal(talkTo(world, hero, 'oda', 'turnIn', 'main').ok, false);
    assert.ok(talkTo(world, hero, 'maren', 'turnIn', 'main').ok);
  });

  it('lets heroes show only titles they have earned', () => {
    const world = makeWorld();
    const hero = spawnHero(world, 'Titled', 2);
    assert.equal(world.execute(hero.id, { kind: 'title', title: 'glasswalker' }).ok, false);
    hero.progress.titles.push('glasswalker');
    assert.ok(world.execute(hero.id, { kind: 'title', title: 'glasswalker' }).ok);
    assert.equal(hero.progress.title, 'glasswalker');
    assert.ok(world.execute(hero.id, { kind: 'title', title: null }).ok);
    assert.equal(hero.progress.title, null);
  });

  it('trades Ember Marks for tonics and a title at Oda’s forge', () => {
    const world = makeWorld();
    const hero = spawnHero(world, 'Trader', 2);
    standAt(hero, findNpc(world.npcs, 'oda')!);
    const buy = (item: string) => world.execute(hero.id, { kind: 'npc', npc: 'oda', action: 'buy', arg: item });
    assert.equal(buy('tonicSatchel').ok, false, 'no Marks yet');
    hero.progress.marks = 9;
    const tonics = hero.progress.tonics;
    assert.ok(buy('tonicSatchel').ok);
    assert.equal(hero.progress.tonics, tonics + 3);
    assert.ok(buy('lanternbearer').ok);
    assert.equal(hero.progress.marks, 0);
    assert.ok(hero.progress.titles.includes('lanternbearer'));
    hero.progress.marks = 8;
    assert.equal(buy('lanternbearer').ok, false, 'a title is bought once');
  });
});

describe('daily bounties', () => {
  const makeService = (board: readonly string[]) => {
    const events = new EventBuffer();
    return { events, service: new BountyService(events, new ProgressionService(events), () => board) };
  };
  const heroAt = (level: number): Player => {
    const world = makeWorld();
    return spawnHero(world, 'Bounty', level);
  };

  it('pays for each bounty once, plus a bonus for all three', () => {
    const { service } = makeService(['hunt', 'courier', 'scout:sunken-pier+hollow-shrine']);
    const hero = heroAt(6);
    service.refresh(hero, 20_000);
    const gold = hero.progress.gold;
    const marks = hero.progress.marks;
    for (let i = 0; i < 10; i++) service.onAchievement(hero, { kind: 'kill', monster: 'boar', level: 6 }, 20_000);
    assert.deepEqual(hero.progress.bounties.done, [true, false, false]);
    assert.equal(hero.progress.gold, gold + bountyGold(6));
    for (const npc of ['tamsin', 'bryn', 'sefa', 'tamsin'] as const) service.onAchievement(hero, { kind: 'greet', npc }, 20_000);
    service.onAchievement(hero, { kind: 'visit', place: 'sunken-pier' }, 20_000);
    service.onAchievement(hero, { kind: 'visit', place: 'hollow-shrine' }, 20_000);
    assert.deepEqual(hero.progress.bounties.done, [true, true, true]);
    assert.equal(hero.progress.marks, marks + 3 * BOUNTY_MARKS + ALL_BOUNTIES_MARKS);
    for (let i = 0; i < 10; i++) service.onAchievement(hero, { kind: 'kill', monster: 'boar', level: 6 }, 20_000);
    assert.equal(hero.progress.marks, marks + 3 * BOUNTY_MARKS + ALL_BOUNTIES_MARKS, 'nothing more today');
  });

  it('measures the hunt against the hero’s level', () => {
    const { service } = makeService(['hunt', 'bigGame', 'courier']);
    const hero = heroAt(10);
    service.refresh(hero, 1);
    service.onAchievement(hero, { kind: 'kill', monster: 'puffcap', level: 2 }, 1);
    service.onAchievement(hero, { kind: 'kill', monster: 'golem', level: 12 }, 1);
    assert.deepEqual(hero.progress.bounties.counts, [1, 1, 0]);
  });

  it('clears yesterday’s progress when the day changes', () => {
    const { service } = makeService(['hunt', 'bigGame', 'courier']);
    const hero = heroAt(4);
    service.refresh(hero, 1);
    service.onAchievement(hero, { kind: 'kill', monster: 'toad', level: 4 }, 1);
    assert.equal(hero.progress.bounties.counts[0], 1);
    service.onAchievement(hero, { kind: 'kill', monster: 'toad', level: 4 }, 2);
    assert.equal(hero.progress.bounties.day, 2);
    assert.equal(hero.progress.bounties.counts[0], 1, 'only the new day’s kill counts');
  });

  it('posts the new board to heroes already in the world at midnight', () => {
    const calendar = new FakeCalendar(30_000);
    const world = makeWorld(constantRandom(), calendar);
    const hero = spawnHero(world, 'Nightowl', 3);
    assert.equal(hero.progress.bounties.day, 30_000);
    calendar.day = 30_001;
    runTicks(world, 10);
    assert.equal(hero.progress.bounties.day, 30_001);
    assert.ok(world.drainEvents().some((r) => r.event.e === 'toast' && r.event.text.includes('New bounties')));
  });
});

describe('hero records', () => {
  it('migrates a save from before the story engine', () => {
    const legacy = {
      accountId: 'abc', name: 'Old', level: 8, xp: 10, gold: 50, tonics: 2, weapon: 1, falls: 0,
      quest: 3, questProgress: 2, questState: 'active', createdAt: 'a', updatedAt: 'b',
    };
    const record = parsePlayerRecord(legacy)!;
    assert.deepEqual(record.story.main, { step: 3, progress: 2, state: 'active' });
    assert.deepEqual(record.story.bell, { step: 0, progress: 0, state: 'available' });
    assert.equal(record.marks, 0);
    assert.deepEqual(record.titles, []);
  });

  it('gives heroes who already beat the Warden their title', () => {
    const record = parsePlayerRecord({
      accountId: 'abc', name: 'Champ', level: 15, xp: 0, gold: 0, tonics: 0, weapon: 5, falls: 2,
      quest: 6, questProgress: 0, questState: 'done',
    })!;
    assert.equal(record.story.main.step, chainById('main').steps.length);
    assert.deepEqual(record.titles, ['hero']);
  });

  it('round-trips a modern hero and defaults damaged optional fields', () => {
    const world = makeWorld();
    const base = newPlayerRecord('acc', 'Saver', 'now');
    const hero = world.spawnPlayer('acc', 0, progressFromRecord(base));
    hero.progress.marks = 7;
    hero.progress.titles.push('bellfinder');
    hero.progress.title = 'bellfinder';
    hero.progress.story.thief = { step: 2, progress: 1, state: 'active' };
    const saved = JSON.parse(JSON.stringify(recordFromPlayer(base, hero, 'later')));
    const loaded = parsePlayerRecord(saved)!;
    assert.equal(loaded.marks, 7);
    assert.equal(loaded.title, 'bellfinder');
    assert.deepEqual(loaded.story.thief, { step: 2, progress: 1, state: 'active' });
    assert.deepEqual(loaded.bounties, hero.progress.bounties);

    const damaged = parsePlayerRecord({ ...saved, bounties: { day: 'x' }, title: 'king', marks: -4 })!;
    assert.equal(damaged.marks, 0);
    assert.equal(damaged.title, null);
    assert.equal(damaged.bounties.day, -1);
  });

  it('never shares progress objects between the stored record and the live hero', () => {
    const base = { ...newPlayerRecord('acc', 'Copy', 'now') };
    const progress = progressFromRecord(base);
    progress.story.main.progress = 5;
    progress.titles.push('hero');
    assert.equal(base.story.main.progress, 0);
    assert.deepEqual(base.titles, []);
    assert.deepEqual(newProgress('x').titles, []);
  });
});
