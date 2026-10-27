import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Block, SIM_DT, VoxelWorld, copyBody, createBody, stepPlayer, type InputFrame, type MoveIntent, type SelfState } from '@lanternwood/shared';
import { resolveServerUrl } from '../src/app/server-url';
import { ClockSync } from '../src/state/clock-sync';
import { EntityStore } from '../src/state/entity-store';
import { LocalPlayer } from '../src/state/local-player';
import { SnapshotBuffer } from '../src/state/snapshot-buffer';

function flatWorld(): VoxelWorld {
  const w = new VoxelWorld();
  for (let x = -20; x <= 20; x++) for (let z = -20; z <= 20; z++) w.set(x, 0, z, Block.Stone);
  w.set(4, 1, 0, Block.Stone);
  return w;
}

const intentAt = (i: number): MoveIntent => ({ fwd: 1, strafe: Math.sin(i * 0.2), yaw: -Math.PI / 2 + i * 0.01, jump: i === 12, swim: false });

const selfFrom = (body: ReturnType<typeof createBody>): SelfState => ({
  x: body.x, y: body.y, z: body.z, vx: body.vx, vy: body.vy, vz: body.vz, g: body.grounded,
  hp: 90, mhp: 90, mp: 40, mmp: 40, dead: false, cd: { strike: 0, bolt: 0, mend: 0, ring: 0, tonic: 0 },
});

describe('LocalPlayer prediction', () => {
  it('ends up exactly where the server does when the server lags behind', () => {
    const world = flatWorld();
    const local = new LocalPlayer(world);
    local.reset({ x: 0, y: 0.5, z: 0 });
    const server = createBody(0, 0.5, 0);
    const sent: InputFrame[] = [];

    for (let i = 0; i < 40; i++) {
      sent.push(local.step(intentAt(i)));
      // The server is five frames behind and reports back every fourth frame.
      if (i >= 5 && i % 4 === 0) {
        const upTo = i - 5;
        while (sent.length > 0 && sent[0]!.seq <= upTo + 1) {
          const f = sent.shift()!;
          stepPlayer(world, server, f, SIM_DT);
        }
        local.reconcile(selfFrom(server), upTo + 1);
      }
    }
    for (const f of sent) stepPlayer(world, server, f, SIM_DT);
    assert.ok(Math.abs(local.body.x - server.x) < 1e-9);
    assert.ok(Math.abs(local.body.y - server.y) < 1e-9);
    assert.ok(Math.abs(local.body.z - server.z) < 1e-9);
  });

  it('adopts a server correction and smooths it visually instead of jumping', () => {
    const world = flatWorld();
    const local = new LocalPlayer(world);
    local.reset({ x: 0, y: 0.5, z: 0 });
    for (let i = 0; i < 5; i++) local.step({ fwd: 0, strafe: 0, yaw: 0, jump: false, swim: false });
    const before = local.renderPosition(1, 0, { x: 0, y: 0, z: 0 });

    const corrected = createBody(0, 0.5, 0);
    copyBody(local.body, corrected);
    corrected.x += 0.5;
    local.reconcile(selfFrom(corrected), 5);

    assert.equal(local.body.x, before.x + 0.5, 'simulation adopts the server position at once');
    const shown = local.renderPosition(1, 0, { x: 0, y: 0, z: 0 });
    assert.ok(Math.abs(shown.x - before.x) < 1e-9, 'but the rendered position does not jump');
    for (let i = 0; i < 60; i++) local.renderPosition(1, 1 / 60, shown);
    assert.ok(Math.abs(shown.x - local.body.x) < 0.01, 'and converges within a second');
  });

  it('snaps on teleports such as respawning in town', () => {
    const local = new LocalPlayer(flatWorld());
    local.reset({ x: 0, y: 0.5, z: 0 });
    local.reconcile(selfFrom(createBody(15, 0.5, 15)), 0);
    const shown = local.renderPosition(1, 0, { x: 0, y: 0, z: 0 });
    assert.equal(shown.x, 15);
  });
});

describe('SnapshotBuffer', () => {
  it('interpolates between the two samples around the requested time', () => {
    const buffer = new SnapshotBuffer();
    buffer.push({ t: 1, x: 0, y: 0, z: 0, yaw: 0 });
    buffer.push({ t: 2, x: 10, y: 2, z: -4, yaw: 1 });
    const out = { x: 0, y: 0, z: 0, yaw: 0 };
    buffer.sample(1.25, out);
    assert.deepEqual(out, { x: 2.5, y: 0.5, z: -1, yaw: 0.25 });
  });

  it('turns the short way round when yaw wraps', () => {
    const buffer = new SnapshotBuffer();
    buffer.push({ t: 0, x: 0, y: 0, z: 0, yaw: 3.0 });
    buffer.push({ t: 1, x: 0, y: 0, z: 0, yaw: -3.0 });
    const out = { x: 0, y: 0, z: 0, yaw: 0 };
    buffer.sample(0.5, out);
    assert.ok(Math.abs(Math.abs(out.yaw) - Math.PI) < 0.01, `yaw = ${out.yaw}`);
  });

  it('extrapolates only a little past the newest sample, then holds', () => {
    const buffer = new SnapshotBuffer();
    buffer.push({ t: 0, x: 0, y: 0, z: 0, yaw: 0 });
    buffer.push({ t: 0.1, x: 1, y: 0, z: 0, yaw: 0 });
    const out = { x: 0, y: 0, z: 0, yaw: 0 };
    buffer.sample(5, out);
    assert.ok(out.x <= 2 + 1e-9, `x = ${out.x}`);
  });

  it('ignores stale or duplicate samples', () => {
    const buffer = new SnapshotBuffer();
    buffer.push({ t: 2, x: 5, y: 0, z: 0, yaw: 0 });
    buffer.push({ t: 1, x: 99, y: 0, z: 0, yaw: 0 });
    assert.equal(buffer.latest?.x, 5);
  });
});

describe('EntityStore', () => {
  it('reports entities entering and leaving the area of interest', () => {
    const store = new EntityStore();
    const puff = { k: 'm', id: 3, x: 0, y: 0, z: 0, yaw: 0, hp: 10, mhp: 10, lv: 1, ty: 'puffcap', sc: 1, st: 'idle' } as const;
    assert.equal(store.apply([puff], 1).added.length, 1);
    assert.equal(store.apply([puff], 1.1).added.length, 0);
    const changes = store.apply([], 1.2);
    assert.deepEqual(changes.removed.map((e) => e.id), [3]);
  });
});

describe('ClockSync and server URL', () => {
  it('tracks the smallest network delay seen', () => {
    const clock = new ClockSync();
    clock.observe(10, 100.2);
    clock.observe(11, 101.05);
    assert.ok(clock.serverNow(101.05) > 10.85 && clock.serverNow(101.05) < 11.01);
  });

  it('defaults to the page origin and accepts a ws:// override', () => {
    assert.equal(resolveServerUrl({ protocol: 'https:', host: 'game.example', search: '' }), 'wss://game.example/ws');
    assert.equal(resolveServerUrl({ protocol: 'http:', host: 'localhost:5173', search: '?server=ws://10.0.0.2:8080/ws' }), 'ws://10.0.0.2:8080/ws');
    assert.equal(resolveServerUrl({ protocol: 'http:', host: 'a', search: '?server=javascript:alert(1)' }), 'ws://a/ws');
  });
});
