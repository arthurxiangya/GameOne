import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Biome, NO_GROUND, WORLD, generateWorld, hash3 } from '../src/index';

const checksum = (data: Uint8Array): number => {
  let h = 0;
  for (let i = 0; i < data.length; i += 7) h = (Math.imul(h, 31) + data[i]! + i) | 0;
  return h;
};

describe('generateWorld', () => {
  const generated = generateWorld(2026);
  const { world } = generated;

  it('is deterministic for a seed, so clients can rebuild the server world', () => {
    const again = generateWorld(2026);
    assert.equal(checksum(again.world.blocks), checksum(world.blocks));
    assert.deepEqual(again.monsterSpawns, generated.monsterSpawns);
  });

  it('produces a different world for a different seed', () => {
    assert.notEqual(checksum(generateWorld(7).world.blocks), checksum(world.blocks));
  });

  it('places the player spawn on solid ground in town', () => {
    const { x, y, z } = generated.playerSpawn;
    assert.ok(world.isSolid(Math.round(x), Math.round(y - 0.5), Math.round(z)));
    assert.ok(!world.isSolid(Math.round(x), Math.round(y + 0.5), Math.round(z)));
    assert.equal(world.biomeAt(x, z), Biome.Town);
  });

  it('keeps dry land walkable: neighbouring columns differ by at most one block', () => {
    let worst = 0;
    world.forEachColumn((x, z, i) => {
      const t = world.topY[i]!;
      if (t === NO_GROUND || t < WORLD.waterLevel || x === world.maxX) return;
      const n = world.topY[world.column(x + 1, z)]!;
      if (n === NO_GROUND || n < WORLD.waterLevel) return;
      worst = Math.max(worst, Math.abs(n - t));
    });
    assert.ok(worst <= 1, `steepest step was ${worst}`);
  });

  it('spawns every monster type, with the Warden alone on its peak', () => {
    const counts = new Map<string, number>();
    for (const s of generated.monsterSpawns) counts.set(s.type, (counts.get(s.type) ?? 0) + 1);
    for (const type of ['puffcap', 'toad', 'boar', 'scuttler', 'golem']) assert.ok((counts.get(type) ?? 0) >= 8, `${type} count`);
    assert.equal(counts.get('warden'), 1);
  });

  it('has a lake that spills off the edge as waterfalls', () => {
    assert.ok(generated.waterfalls.length >= 1);
  });

  it('hash3 is stable and in [0, 1)', () => {
    const v = hash3(1, 2, 3, 4);
    assert.equal(v, hash3(1, 2, 3, 4));
    assert.ok(v >= 0 && v < 1);
  });
});
