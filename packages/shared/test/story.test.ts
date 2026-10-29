import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CHAINS,
  LANDMARK_IDS,
  MONSTERS,
  NPC_IDS,
  TITLES,
  bountiesForDay,
  bountyCount,
  bountyFromId,
  chainStatus,
  generateWorld,
  isVisiting,
  killCounts,
  newChainProgress,
  objectiveText,
} from '../src/index';

describe('story scripts', () => {
  it('only reference characters, places, monsters and titles that exist', () => {
    for (const chain of CHAINS) {
      assert.ok(NPC_IDS.includes(chain.giver), `${chain.id} giver`);
      assert.ok(chain.steps.length > 0);
      assert.ok(chain.steps[0]!.accept, `${chain.id} must be accepted before it starts`);
      for (const step of chain.steps) {
        const o = step.objective;
        if (o.kind === 'defeat' || o.kind === 'collect') assert.ok(o.monster in MONSTERS, step.title);
        if (o.kind === 'visit') assert.ok(LANDMARK_IDS.includes(o.place), step.title);
        if (o.kind === 'talk') {
          assert.ok(NPC_IDS.includes(o.npc), step.title);
          assert.equal(step.turnIn, o.npc, `${step.title}: a talk step completes at the character it names`);
        }
        if (step.turnIn) assert.ok(NPC_IDS.includes(step.turnIn), step.title);
        if (step.reward.title) assert.ok(step.reward.title in TITLES, step.title);
        assert.ok(step.offer && step.remind && step.done, `${step.title} has all its lines`);
      }
    }
  });

  it('locks a chain until the hero reaches its level, and reports a finished chain as done', () => {
    const bell = CHAINS.find((c) => c.id === 'bell')!;
    assert.equal(chainStatus(bell, newChainProgress(), 1), 'locked');
    assert.equal(chainStatus(bell, newChainProgress(), 3), 'available');
    assert.equal(chainStatus(bell, { step: bell.steps.length, progress: 0, state: 'active' }, 3), 'done');
  });

  it('describes objectives with their progress', () => {
    assert.equal(objectiveText({ kind: 'defeat', monster: 'boar', count: 6 }, 2), 'Bramble Boars defeated 2 / 6');
    assert.equal(objectiveText({ kind: 'collect', monster: 'toad', count: 4, item: 'Bell shard' }, 9), 'Bell shards 4 / 4');
    assert.equal(objectiveText({ kind: 'visit', place: 'sunken-pier' }, 0), 'Find the Sunken Pier');
    assert.equal(objectiveText({ kind: 'talk', npc: 'maren' }, 0), 'Talk to Elder Maren');
  });
});

describe('daily bounties', () => {
  const options = { duels: false };

  it('posts the same three bounties for a day, and a different board on other days', () => {
    const today = bountiesForDay(2026, 20_000, options);
    assert.deepEqual(bountiesForDay(2026, 20_000, options), today);
    assert.equal(today.length, 3);
    assert.equal(new Set(today).size, 3, 'no bounty twice in a day');
    const boards = new Set(Array.from({ length: 30 }, (_, d) => bountiesForDay(2026, 20_000 + d, options).join()));
    assert.ok(boards.size > 4, `only ${boards.size} different boards in 30 days`);
  });

  it('rebuilds every posted bounty from its id', () => {
    for (let d = 0; d < 60; d++) {
      for (const id of bountiesForDay(7, d, options)) assert.ok(bountyFromId(id), id);
    }
    assert.equal(bountyFromId('scout:sunken-pier+sunken-pier'), null);
    assert.equal(bountyFromId('dragons'), null);
  });

  it('measures fight bounties against the hero’s own level', () => {
    assert.ok(killCounts('hunt', 7, 10));
    assert.ok(!killCounts('hunt', 6, 10));
    assert.ok(killCounts('bigGame', 11, 10));
    assert.ok(!killCounts('bigGame', 10, 10));
  });

  it('counts scout and courier bounties from what the hero has seen today', () => {
    const scout = bountyFromId('scout:sunken-pier+hollow-shrine')!;
    assert.equal(bountyCount(scout, 0, ['place:sunken-pier', 'npc:tamsin']), 1);
    const courier = bountyFromId('courier')!;
    assert.equal(bountyCount(courier, 0, ['npc:tamsin', 'npc:bryn', 'npc:sefa', 'npc:tamsin']), 3);
  });
});

describe('landmarks and characters in the generated world', () => {
  for (const seed of [2026, 7, 99, 4242]) {
    it(`places every landmark and character on solid ground (seed ${seed})`, () => {
      const generated = generateWorld(seed);
      const { world } = generated;
      assert.deepEqual(generated.landmarks.map((l) => l.id), [...LANDMARK_IDS]);
      for (const l of generated.landmarks) {
        assert.ok(world.groundTop(l.x, l.z) >= 9, `${l.id} is on dry ground`);
        assert.ok(isVisiting(l, l.x, world.surfaceY(l.x, l.z), l.z));
      }
      assert.deepEqual(generated.npcs.map((n) => n.id), [...NPC_IDS]);
      for (const npc of generated.npcs) {
        assert.ok(world.groundTop(npc.x, npc.z) >= 9, `${npc.id} stands on dry ground`);
        assert.ok(!world.isSolid(Math.round(npc.x), world.groundTop(npc.x, npc.z) + 1, Math.round(npc.z)), `${npc.id} is not inside a block`);
      }
    });
  }

  it('builds the pier out over the water', () => {
    const generated = generateWorld(2026);
    const pier = generated.landmarks.find((l) => l.id === 'sunken-pier')!;
    let planks = 0;
    for (let dx = -5; dx <= 5; dx++) {
      for (let dz = -5; dz <= 5; dz++) {
        for (let y = 7; y <= 10; y++) if (generated.world.get(pier.x + dx, y, pier.z + dz) === 14) planks++;
      }
    }
    assert.ok(planks >= 3, `found ${planks} planks`);
  });
});
