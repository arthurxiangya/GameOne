import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { newProgress } from '@lanternwood/shared';
import { TokenBucket } from '../src/application/rate-limiter';
import { SpatialHash } from '../src/application/spatial-hash';
import { ConfigError, loadConfig } from '../src/config';
import { newPlayerRecord } from '../src/domain/player-record';
import { JsonFilePlayerRepository } from '../src/infrastructure/persistence/json-file-player-repository';

describe('JsonFilePlayerRepository', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lanternwood-'));
  after(() => rm(dir, { recursive: true, force: true }));
  const repo = new JsonFilePlayerRepository(dir);
  await repo.init();
  const id = 'b'.repeat(32);

  it('round-trips a hero and leaves no temp files behind', async () => {
    const record = { ...newPlayerRecord(id, 'Saved', '2026-01-01T00:00:00Z'), level: 3, gold: 12 };
    await repo.save(record);
    assert.deepEqual(await repo.load(id), record);
    assert.deepEqual(await readdir(dir), [`${id}.json`]);
  });

  it('serialises concurrent saves so the last write wins', async () => {
    const base = newPlayerRecord(id, 'Saved', 'x');
    await Promise.all([1, 2, 3, 4, 5].map((gold) => repo.save({ ...base, gold })));
    assert.equal((await repo.load(id))?.gold, 5);
  });

  it('returns null for unknown heroes and refuses unsafe ids', async () => {
    assert.equal(await repo.load('c'.repeat(32)), null);
    await assert.rejects(repo.load('../../etc/passwd'));
  });

  it('refuses to load a corrupted save rather than overwrite it', async () => {
    const bad = 'd'.repeat(32);
    await writeFile(join(dir, `${bad}.json`), JSON.stringify({ ...newProgress('X'), accountId: bad, level: 999 }));
    await assert.rejects(repo.load(bad));
  });
});

describe('TokenBucket', () => {
  it('allows a burst, then refills over time', () => {
    const bucket = new TokenBucket(3, 1, 0);
    assert.ok(bucket.tryTake(0) && bucket.tryTake(0) && bucket.tryTake(0));
    assert.equal(bucket.tryTake(0), false);
    assert.equal(bucket.tryTake(0.5), false);
    assert.ok(bucket.tryTake(1.1));
  });
});

describe('SpatialHash', () => {
  it('finds exactly the items inside the radius', () => {
    const grid = new SpatialHash<{ x: number; z: number }>(16, (p) => p.x, (p) => p.z);
    const items = [{ x: 0, z: 0 }, { x: 5, z: 5 }, { x: 30, z: 0 }, { x: -17, z: -1 }];
    grid.rebuild(items);
    assert.deepEqual(grid.query(0, 0, 10), [items[0], items[1]]);
    assert.deepEqual(new Set(grid.query(0, 0, 31)), new Set(items));
  });
});

describe('loadConfig', () => {
  it('uses safe defaults', () => {
    const config = loadConfig({}, '/srv/game');
    assert.equal(config.port, 8080);
    assert.equal(config.tickRate, 20);
    assert.equal(config.dataDir, '/srv/game/data');
  });

  it('lists every invalid setting at once', () => {
    assert.throws(
      () => loadConfig({ PORT: 'eighty', TICK_RATE: '500', LOG_LEVEL: 'loud' }),
      (err: unknown) => err instanceof ConfigError && err.problems.length === 3,
    );
  });
});
