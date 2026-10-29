import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CHAINS, MAX_LEVEL, buildChunkMesh, chainById, generateWorld, killGold, killXp, monsterMaxHp, xpToNext } from '../src/index';

describe('progression rules', () => {
  it('requires more experience for every level', () => {
    for (let l = 1; l < MAX_LEVEL; l++) assert.ok(xpToNext(l + 1) > xpToNext(l));
  });

  it('pays less for monsters far below your level and more for bosses', () => {
    assert.ok(killXp(1, 10, false) < killXp(10, 10, false));
    assert.ok(killXp(14, 14, true) > killXp(14, 14, false) * 5);
    assert.ok(killGold(14, true, 0) >= 150);
  });

  it('ends the main story with the boss', () => {
    const last = chainById('main').steps.at(-1)?.objective;
    assert.equal(last?.kind === 'defeat' && last.monster, 'warden');
    assert.ok(CHAINS.length >= 4);
    assert.ok(monsterMaxHp('warden', 14) > monsterMaxHp('golem', 12) * 5);
  });
});

describe('buildChunkMesh', () => {
  const { world } = generateWorld(2026);

  it('builds valid indexed geometry for the town chunk, including glowing lamps', () => {
    const centre = world.chunksX / 2;
    const mesh = buildChunkMesh(world, centre, centre);
    assert.ok(mesh.solid.vertexCount > 1000);
    assert.ok(mesh.glow.vertexCount > 0, 'town lamps should produce glow faces');
    for (const buffers of [mesh.solid, mesh.water, mesh.glow]) {
      assert.equal(buffers.positions.length, buffers.vertexCount * 3);
      assert.equal(buffers.indices.length % 6, 0);
      for (const i of buffers.indices) assert.ok(i < buffers.vertexCount);
      for (const c of buffers.colors) assert.ok(c >= 0 && c <= 1.2);
    }
  });

  it('returns empty buffers for chunks past the island edge', () => {
    const mesh = buildChunkMesh(world, 0, 0);
    assert.equal(mesh.solid.vertexCount, 0);
  });
});
