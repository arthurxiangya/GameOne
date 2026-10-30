import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PROTOCOL_VERSION, isFullEntity, newProgress, type ServerMessage } from '@lanternwood/shared';
import { InMemoryPlayerRepository, createEmbeddedServer, localTokenHasher, type SystemTime } from '@lanternwood/server/embedded';
import { resolvePlayMode } from '../src/app/play-mode';
import { LoopbackTransport } from '../src/net/loopback-transport';
import { LocalStoragePlayerRepository, type KeyValueStorage } from '../src/offline/local-storage-player-repository';

const time: SystemTime = { monotonic: () => performance.now() / 1000, iso: () => new Date().toISOString() };
const token = 'c'.repeat(64);

function collect() {
  const messages: ServerMessage[] = [];
  const waiters: (() => void)[] = [];
  let closed: { code: number; reason: string } | null = null;
  return {
    messages,
    get closed() {
      return closed;
    },
    handlers: {
      open: () => undefined,
      message: (m: ServerMessage) => {
        messages.push(m);
        for (const w of [...waiters]) w();
      },
      close: (code: number, reason: string) => {
        closed = { code, reason };
      },
    },
    waitFor<T extends ServerMessage>(predicate: (m: ServerMessage) => m is T, timeoutMs = 4000): Promise<T> {
      return new Promise((resolve, reject) => {
        const check = (): void => {
          const found = messages.find(predicate);
          if (!found) return;
          waiters.splice(waiters.indexOf(check), 1);
          clearTimeout(timer);
          resolve(found);
        };
        const timer = setTimeout(() => reject(new Error('timed out waiting for a server message')), timeoutMs);
        waiters.push(check);
        check();
      });
    },
  };
}

describe('single-player mode', () => {
  it('plays through the in-page server: join, move, get acknowledged, and save on leave', async () => {
    const repository = new InMemoryPlayerRepository();
    const server = createEmbeddedServer({ repository, time });
    const inbox = collect();
    let opened = false;
    const transport = new LoopbackTransport(() => server, {
      ...inbox.handlers,
      open: () => {
        opened = true;
        transport.send({ t: 'hello', v: PROTOCOL_VERSION, token, name: 'Solo', cls: 'lightkeeper' });
      },
    });
    try {
      transport.open();
      const welcome = await inbox.waitFor((m): m is Extract<ServerMessage, { t: 'welcome' }> => m.t === 'welcome');
      assert.ok(opened);
      assert.equal(welcome.progress.name, 'Solo');
      assert.equal(welcome.seed, 2026);

      const frames = Array.from({ length: 6 }, (_, i) => ({ seq: i + 1, fwd: 1, strafe: 0, yaw: 0, jump: false, swim: false }));
      transport.send({ t: 'input', frames });
      const acked = await inbox.waitFor(
        (m): m is Extract<ServerMessage, { t: 'snapshot' }> => m.t === 'snapshot' && m.ack === 6,
      );
      assert.ok(acked.you.z < 5, 'walking forward moves toward -z');
      assert.ok(inbox.messages.some((m) => m.t === 'snapshot' && m.ents.some((e) => isFullEntity(e) && e.k === 'm')), 'monsters near town are visible');

      transport.close();
      await new Promise((r) => setTimeout(r, 10));
      assert.equal(repository.size, 1, 'leaving saves the hero');
      assert.equal(inbox.closed, null, 'closing from the client does not report a server close');
    } finally {
      await server.stop();
    }
  });

  it('reports a server-side close to the client', async () => {
    const server = createEmbeddedServer({ repository: new InMemoryPlayerRepository(), time });
    const inbox = collect();
    const transport = new LoopbackTransport(() => server, {
      ...inbox.handlers,
      open: () => transport.send({ t: 'hello', v: PROTOCOL_VERSION + 99, token, name: 'Old Page', cls: 'warden' }),
    });
    transport.open();
    await inbox.waitFor((m): m is Extract<ServerMessage, { t: 'reject' }> => m.t === 'reject');
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(inbox.closed?.code, 4403);
    assert.equal(transport.isOpen, false);
    await server.stop();
  });

  it('keeps single-player heroes in browser storage, and survives storage being unavailable', async () => {
    const data = new Map<string, string>();
    const storage: KeyValueStorage = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
    const id = localTokenHasher(token);
    const repo = new LocalStoragePlayerRepository(storage);
    const record = { ...newProgress('Solo'), accountId: id, level: 4, xp: 10, gold: 50, marks: 3, createdAt: 'a', updatedAt: 'b' };
    record.story.bell = { step: 2, progress: 1, state: 'active' };
    await repo.save(record);
    assert.deepEqual(await new LocalStoragePlayerRepository(storage).load(id), record);

    // A hero saved by an older build of the preview is migrated, not lost.
    data.set([...data.keys()][0]!, JSON.stringify({ accountId: id, name: 'Solo', level: 4, xp: 10, gold: 50, tonics: 2, weapon: 1, falls: 0, quest: 2, questProgress: 3, questState: 'active' }));
    assert.deepEqual((await repo.load(id))?.story.main, { step: 2, progress: 3, state: 'active' });

    const blocked: KeyValueStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    const fallback = new LocalStoragePlayerRepository(blocked);
    await fallback.save(record);
    assert.deepEqual(await fallback.load(id), record);
  });

  it('chooses the play mode from the URL and the build', () => {
    const page = { protocol: 'https:', host: 'game.example', search: '' };
    assert.deepEqual(resolvePlayMode(page, undefined), { kind: 'online', serverUrl: 'wss://game.example/ws' });
    assert.deepEqual(resolvePlayMode(page, 'offline'), { kind: 'offline' });
    assert.deepEqual(resolvePlayMode({ ...page, search: '?offline' }, undefined), { kind: 'offline' });
    assert.equal(resolvePlayMode({ ...page, search: '?server=wss://other.example/ws' }, 'offline').kind, 'online');
  });

  it('derives stable 32-hex-character local account ids', () => {
    assert.match(localTokenHasher(token), /^[a-f0-9]{32}$/);
    assert.equal(localTokenHasher(token), localTokenHasher(token));
    assert.notEqual(localTokenHasher(token), localTokenHasher('d'.repeat(64)));
  });
});
