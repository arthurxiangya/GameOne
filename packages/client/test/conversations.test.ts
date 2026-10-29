import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { findNpc, generateWorld, newProgress, type PlayerProgress } from '@lanternwood/shared';
import { npcMark, npcTopics, untilNewBounties } from '../src/app/conversations';
import { defaultTracked, objectiveSpot, trackerInfo } from '../src/app/objectives';

const realm = generateWorld(2026);
const npc = (id: Parameters<typeof findNpc>[1]) => findNpc(realm.npcs, id)!;
const hero = (level: number, edit?: (p: PlayerProgress) => void): PlayerProgress => {
  const p = { ...newProgress('Talker'), level };
  edit?.(p);
  return p;
};

describe('conversations', () => {
  it('offers a new story with a gold ! and an Accept button that names the chain', () => {
    const p = hero(3);
    assert.equal(npcMark(npc('tamsin'), p), '!');
    const [offer] = npcTopics(npc('tamsin'), p, 0);
    assert.equal(offer?.title, 'A Bell Beneath the Water');
    assert.deepEqual(offer?.actions[0]?.send, { action: 'accept', arg: 'bell' });
  });

  it('keeps a locked story quiet until the hero is strong enough', () => {
    const p = hero(1);
    assert.equal(npcMark(npc('sefa'), p), '');
    assert.match(npcTopics(npc('sefa'), p, 0)[0]!.label, /level 7/);
  });

  it('marks the character a talk step points at with a ?', () => {
    const p = hero(4, (x) => (x.story.bell = { step: 2, progress: 0, state: 'active' }));
    assert.equal(npcMark(npc('maren'), p), '?');
    const topic = npcTopics(npc('maren'), p, 0).find((t) => t.key === 'story:bell')!;
    assert.deepEqual(topic.actions[0]?.send, { action: 'talk', arg: 'bell' });
    assert.equal(topic.mark, '?');
  });

  it('puts things to hand in before the shop', () => {
    const p = hero(6, (x) => (x.story.thief = { step: 3, progress: 0, state: 'active' }));
    const keys = npcTopics(npc('oda'), p, 0).map((t) => t.key);
    assert.deepEqual(keys, ['story:thief', 'forge', 'marks']);
  });

  it('shows the day’s bounties at Captain Rook, and how long until new ones', () => {
    const p = hero(5, (x) => (x.bounties = { day: 1, ids: ['hunt', 'courier', 'bigGame'], counts: [4, 0, 3], done: [false, false, true], seen: ['npc:bryn'] }));
    const board = npcTopics(npc('rook'), p, 0).find((t) => t.key === 'bounties')!;
    assert.match(String(board.paragraphs[0]), /Hunt.*4 \/ 10/);
    assert.match(String(board.paragraphs[1]), /Courier.*1 \/ 3/);
    assert.match(String(board.paragraphs[2]), /✓ Big game/);
    assert.equal(untilNewBounties(86_400_000 - 90 * 60_000), '1h 30m');
  });

  it('lets a character with nothing to say just chat', () => {
    const p = hero(2, (x) => (x.story.main = { step: 6, progress: 0, state: 'active' }));
    assert.deepEqual(npcTopics(npc('ilka'), p, 0).map((t) => t.key), ['idle']);
  });
});

describe('story tracking', () => {
  it('follows something to hand in before anything else', () => {
    const p = hero(8, (x) => {
      x.story.main = { step: 2, progress: 1, state: 'active' };
      x.story.thief = { step: 1, progress: 6, state: 'ready' };
    });
    assert.equal(defaultTracked(p), 'thief');
  });

  it('points the map at the place, the person or the nearest monster the step needs', () => {
    const from = { x: 0, z: 0 };
    const visiting = hero(3, (x) => (x.story.bell = { step: 0, progress: 0, state: 'active' }));
    const pier = realm.landmarks.find((l) => l.id === 'sunken-pier')!;
    assert.deepEqual(objectiveSpot(visiting, 'bell', realm, [], from), pier);

    const talking = hero(3, (x) => (x.story.bell = { step: 2, progress: 0, state: 'active' }));
    assert.equal(objectiveSpot(talking, 'bell', realm, [], from), npc('maren'));

    const hunting = hero(3, (x) => (x.story.bell = { step: 1, progress: 0, state: 'active' }));
    const near = objectiveSpot(hunting, 'bell', realm, [{ type: 'toad', x: 3, z: 4 }, { type: 'toad', x: 30, z: 4 }], from);
    assert.deepEqual(near, { type: 'toad', x: 3, z: 4 });
    assert.ok(objectiveSpot(hunting, 'bell', realm, [], from), 'falls back to spawn points');
  });

  it('describes the tracked step for the HUD', () => {
    const p = hero(1);
    assert.equal(trackerInfo(p, 'main').objective, 'Talk to Elder Maren');
    assert.equal(trackerInfo(p, null).kind, 'Realm');
  });
});
