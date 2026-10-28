import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { WebSocket, type RawData } from 'ws';
import { PROTOCOL_VERSION, applyEntityUpdates, decodeServerMessage, type ClientMessage, type EntityState, type ServerMessage } from '@lanternwood/shared';
import { createGameServer, type GameServer } from '../src/app';
import { nullLogger } from '../src/application/ports';
import { loadConfig } from '../src/config';
import { InMemoryPlayerRepository } from '../src/infrastructure/persistence/in-memory-player-repository';
import { systemTime } from '../src/infrastructure/time/system-time';
import { token } from './support';

interface TestClient {
  readonly messages: ServerMessage[];
  /** Entities in view, with every snapshot's deltas applied. */
  readonly entities: Map<number, EntityState>;
  send(msg: ClientMessage): void;
  waitFor<T extends ServerMessage>(predicate: (m: ServerMessage) => m is T, timeoutMs?: number): Promise<T>;
  close(): void;
}

function connect(port: number): Promise<TestClient> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const messages: ServerMessage[] = [];
    const entities = new Map<number, EntityState>();
    const waiters: (() => void)[] = [];
    socket.on('message', (data: RawData) => {
      const msg = decodeServerMessage(data.toString());
      if (msg?.t === 'snapshot') applyEntityUpdates(entities, msg.ents, msg.gone);
      if (msg) messages.push(msg);
      for (const w of [...waiters]) w();
    });
    socket.on('error', reject);
    socket.on('open', () =>
      resolve({
        messages,
        entities,
        send: (msg) => socket.send(JSON.stringify(msg)),
        close: () => socket.close(),
        waitFor: (predicate, timeoutMs = 4000) =>
          new Promise((res, rej) => {
            const check = (): boolean => {
              const found = messages.find(predicate);
              if (found) {
                waiters.splice(waiters.indexOf(check as () => void), 1);
                clearTimeout(timer);
                res(found);
                return true;
              }
              return false;
            };
            const timer = setTimeout(() => rej(new Error('timed out waiting for message')), timeoutMs);
            waiters.push(check as () => void);
            check();
          }),
      }),
    );
  });
}

describe('game server end to end', () => {
  let server: GameServer;
  let port: number;
  let staticDir: string;
  const secretName = `lanternwood-secret-${process.pid}.txt`;

  before(async () => {
    staticDir = await mkdtemp(join(tmpdir(), 'lanternwood-client-'));
    await writeFile(join(staticDir, 'index.html'), '<!doctype html><title>test</title>');
    await writeFile(join(staticDir, '..', secretName), 'top secret');
    const config = loadConfig({ PORT: '0', HOST: '127.0.0.1', CLIENT_DIST: staticDir });
    server = createGameServer({ config, logger: nullLogger, time: systemTime, repository: new InMemoryPlayerRepository() });
    port = await server.listen();
  });

  after(async () => {
    await server.stop();
    await rm(staticDir, { recursive: true, force: true });
    await rm(join(staticDir, '..', secretName), { force: true });
  });

  it('serves the client and a health probe, and refuses path traversal', async () => {
    const health = await fetch(`http://127.0.0.1:${port}/healthz`);
    assert.equal(health.status, 200);
    assert.equal(((await health.json()) as { status: string }).status, 'ok');
    const index = await fetch(`http://127.0.0.1:${port}/some/route`);
    assert.match(await index.text(), /<title>test<\/title>/);
    // %2f keeps the URL parser from normalising "..", so this reaches the server's own guard.
    const escape = await fetch(`http://127.0.0.1:${port}/%2e%2e%2f${secretName}`);
    assert.equal(escape.status, 404);
    assert.doesNotMatch(await escape.text(), /top secret/);
  });

  it('lets two heroes join, see each other move, and chat', async () => {
    const a = await connect(port);
    const b = await connect(port);
    try {
      a.send({ t: 'hello', v: PROTOCOL_VERSION, token: token(1001), name: 'Aria' });
      b.send({ t: 'hello', v: PROTOCOL_VERSION, token: token(1002), name: 'Bram' });
      const welcomeA = await a.waitFor((m): m is Extract<ServerMessage, { t: 'welcome' }> => m.t === 'welcome');
      await b.waitFor((m): m is Extract<ServerMessage, { t: 'welcome' }> => m.t === 'welcome');

      const frames = Array.from({ length: 8 }, (_, i) => ({ seq: i + 1, fwd: 1, strafe: 0, yaw: 0, jump: false, swim: false }));
      a.send({ t: 'input', frames });

      await b.waitFor(
        (m): m is Extract<ServerMessage, { t: 'snapshot' }> =>
          m.t === 'snapshot' && (b.entities.get(welcomeA.you)?.z ?? Infinity) < 4.6,
      );
      const aria = b.entities.get(welcomeA.you);
      assert.equal(aria?.k === 'p' ? aria.nm : null, 'Aria');

      const acked = await a.waitFor((m): m is Extract<ServerMessage, { t: 'snapshot' }> => m.t === 'snapshot' && m.ack === 8);
      assert.ok(acked.you.z < 5);

      a.send({ t: 'chat', text: 'hello Bram' });
      const chat = await b.waitFor((m): m is Extract<ServerMessage, { t: 'chat' }> => m.t === 'chat');
      assert.deepEqual(chat, { t: 'chat', from: 'Aria', text: 'hello Bram' });
    } finally {
      a.close();
      b.close();
    }
  });
});
