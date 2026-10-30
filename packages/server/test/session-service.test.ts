import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PROTOCOL_VERSION, isFullEntity, newProgress } from '@lanternwood/shared';
import { nullLogger } from '../src/application/ports';
import { CloseCode, SessionService } from '../src/application/session-service';
import { InMemoryPlayerRepository } from '../src/infrastructure/persistence/in-memory-player-repository';
import { createTokenHasher } from '../src/infrastructure/security/token-hasher';
import { FakeLink, ManualTime, makeWorld, token } from './support';

function setup(maxPlayers = 4) {
  const world = makeWorld();
  const repository = new InMemoryPlayerRepository();
  const time = new ManualTime();
  const hashToken = createTokenHasher('test');
  const sessions = new SessionService({
    world,
    repository,
    logger: nullLogger,
    time,
    hashToken,
    options: { maxPlayers, interestRadius: 80, snapshotEveryTicks: 1, tickRate: 20, dayLengthSeconds: 480 },
  });
  let n = 0;
  const join = async (name: string, secret = token(++n)): Promise<FakeLink> => {
    const link = new FakeLink(`link-${name}-${n}`);
    sessions.connect(link);
    await sessions.receive(link, JSON.stringify({ t: 'hello', v: PROTOCOL_VERSION, token: secret, name, cls: 'emberblade' }));
    return link;
  };
  const tick = (): void => {
    world.step(0.05);
    sessions.afterTick();
  };
  return { world, repository, time, sessions, join, tick, hashToken };
}

describe('SessionService', () => {
  it('welcomes a new hero and saves them on disconnect', async () => {
    const { sessions, join, repository } = setup();
    const link = await join('Aria');
    const [welcome] = link.of('welcome');
    assert.ok(welcome);
    assert.equal(welcome.progress.name, 'Aria');
    assert.equal(welcome.progress.level, 1);
    assert.equal(sessions.playerCount, 1);

    await sessions.disconnect(link);
    assert.equal(sessions.playerCount, 0);
    assert.equal(repository.size, 1);
  });

  it('restores a returning hero from the repository', async () => {
    const { join, repository, hashToken } = setup();
    const secret = token(4242);
    await repository.save({ ...newProgress('Old Name'), level: 7, gold: 99, accountId: hashToken(secret), createdAt: 'x', updatedAt: 'x' });
    const link = await join('Bram', secret);
    const [welcome] = link.of('welcome');
    assert.equal(welcome?.progress.level, 7);
    assert.equal(welcome?.progress.gold, 99);
    assert.equal(welcome?.progress.name, 'Bram');
  });

  it('rejects play messages before hello and closes connections that keep misbehaving', async () => {
    const { sessions } = setup();
    const link = new FakeLink('rogue');
    sessions.connect(link);
    await sessions.receive(link, JSON.stringify({ t: 'chat', text: 'hi' }));
    assert.equal(link.of('error').length, 1);
    for (let i = 0; i < 40; i++) await sessions.receive(link, '{not json');
    assert.equal(link.closed?.code, CloseCode.ProtocolViolation);
  });

  it('rate-limits floods without closing on the first burst', async () => {
    const { sessions, join } = setup();
    const link = await join('Flood');
    for (let i = 0; i < 100; i++) await sessions.receive(link, JSON.stringify({ t: 'ping', at: i }));
    assert.ok(link.of('pong').length < 100);
    assert.ok(link.of('error').some((e) => /too fast/.test(e.reason)));
  });

  it('broadcasts sanitised chat to everyone in the realm', async () => {
    const { sessions, join } = setup();
    const a = await join('Aria');
    const b = await join('Bram');
    await sessions.receive(a, JSON.stringify({ t: 'chat', text: '  hello\u0000   world ' }));
    assert.deepEqual(b.of('chat').at(-1), { t: 'chat', from: 'Aria', text: 'hello world' });
    assert.equal(a.of('chat').length, 1);
  });

  it('signs out the old window when the same hero joins again', async () => {
    const { sessions, join } = setup();
    const secret = token(77);
    const first = await join('Twin', secret);
    const second = await join('Twin', secret);
    assert.equal(first.closed?.code, CloseCode.SignedInElsewhere);
    assert.ok(second.of('welcome').length === 1);
    assert.equal(sessions.playerCount, 1);
  });

  it('turns away players when the realm is full', async () => {
    const { join } = setup(1);
    await join('One');
    const late = await join('Two');
    assert.equal(late.closed?.code, CloseCode.ServerFull);
    assert.equal(late.of('reject').length, 1);
  });

  it('sends snapshots that show nearby heroes to each other', async () => {
    const { join, tick } = setup();
    const a = await join('Aria');
    const b = await join('Bram');
    tick();
    tick();
    const idA = a.of('welcome')[0]!.you;
    const idB = b.of('welcome')[0]!.you;
    const viewA = a.view();
    const viewB = b.view();
    assert.equal(viewA.get(idB)?.k, 'p');
    assert.equal(viewB.get(idA)?.k, 'p');
    assert.ok([...viewA.values()].some((e) => e.k === 'm'), 'monsters near town should be visible');
  });

  it('sends each entity in full once, then only what changed', async () => {
    const { join, tick } = setup();
    const a = await join('Aria');
    const b = await join('Bram');
    const idB = b.of('welcome')[0]!.you;
    tick();
    tick();
    const [first, second] = a.of('snapshot');
    assert.ok(first?.ents.some((e) => e.id === idB && isFullEntity(e) && e.k === 'p' && e.nm === 'Bram'), 'first snapshot introduces Bram in full');
    assert.ok(!second?.ents.some((e) => e.id === idB), 'a hero standing still is not sent again');
    assert.ok(second!.ents.every((e) => !('ty' in e)), 'unchanged monster details are not resent');
    assert.ok(JSON.stringify(second).length < JSON.stringify(first).length / 2, 'later snapshots are much smaller');
  });

  it('reports heroes that leave the area as gone', async () => {
    const { sessions, join, tick } = setup();
    const a = await join('Aria');
    const b = await join('Bram');
    const idB = b.of('welcome')[0]!.you;
    tick();
    await sessions.disconnect(b);
    tick();
    assert.ok(a.of('snapshot').at(-1)?.gone.includes(idB));
    assert.equal(a.view().has(idB), false);
  });

  it('applies movement input and acknowledges it in the next snapshot', async () => {
    const { sessions, join, tick } = setup();
    const link = await join('Mover');
    const frames = [1, 2, 3].map((seq) => ({ seq, fwd: 1, strafe: 0, yaw: 0, jump: false, swim: false }));
    await sessions.receive(link, JSON.stringify({ t: 'input', frames }));
    for (let i = 0; i < 4; i++) tick();
    const snap = link.of('snapshot').at(-1);
    assert.equal(snap?.ack, 3);
    assert.ok(snap && snap.you.z < 5, 'forward with yaw 0 moves toward -z');
  });
});
