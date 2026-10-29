import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Block, SIM_DT, VoxelWorld, createBody, stepPlayer, type MoveIntent, type PhysicsBody } from '../src/index';

/** A flat 11x11 floor at y = 0 with whatever extra blocks a test adds. */
function floorWorld(extra: (w: VoxelWorld) => void = () => undefined): VoxelWorld {
  const w = new VoxelWorld();
  for (let x = -5; x <= 5; x++) for (let z = -5; z <= 5; z++) w.set(x, 0, z, Block.Stone);
  extra(w);
  return w;
}

const idle: MoveIntent = { fwd: 0, strafe: 0, yaw: 0, jump: false, swim: false };
/** yaw = -PI/2 makes "forward" point along +x. */
const eastward: MoveIntent = { fwd: 1, strafe: 0, yaw: -Math.PI / 2, jump: false, swim: false };

const run = (w: VoxelWorld, body: PhysicsBody, intent: MoveIntent, steps: number): void => {
  for (let i = 0; i < steps; i++) stepPlayer(w, body, intent, SIM_DT);
};

describe('stepPlayer', () => {
  it('falls and lands exactly on top of the floor', () => {
    const w = floorWorld();
    const body = createBody(0, 3, 0);
    run(w, body, idle, 60);
    assert.equal(body.y, 0.5);
    assert.equal(body.grounded, true);
  });

  it('moves faster on a mount, but never swims faster', () => {
    const walk = createBody(-4, 0.5, 0);
    const ride = createBody(-4, 0.5, 0);
    const w = floorWorld();
    for (let i = 0; i < 12; i++) {
      stepPlayer(w, walk, eastward, SIM_DT);
      stepPlayer(w, ride, eastward, SIM_DT, 1.6);
    }
    assert.ok(ride.x - -4 > (walk.x - -4) * 1.5, `walked ${walk.x + 4}, rode ${ride.x + 4}`);
    const water = new VoxelWorld();
    for (let x = -5; x <= 5; x++) for (let z = -5; z <= 5; z++) for (let y = 1; y <= 3; y++) water.set(x, y, z, Block.Water);
    const swimA = createBody(0, 1.5, 0);
    const swimB = createBody(0, 1.5, 0);
    for (let i = 0; i < 10; i++) {
      stepPlayer(water, swimA, eastward, SIM_DT);
      stepPlayer(water, swimB, eastward, SIM_DT, 1.8);
    }
    assert.ok(Math.abs(swimA.x - swimB.x) < 1e-9);
  });

  it('is stopped by a wall two blocks high', () => {
    const w = floorWorld((world) => {
      for (let z = -5; z <= 5; z++) for (let y = 1; y <= 2; y++) world.set(3, y, z, Block.Stone);
    });
    const body = createBody(0, 0.5, 0);
    run(w, body, eastward, 80);
    assert.ok(body.x <= 3 - 0.5 - 0.3 + 1e-3, `x = ${body.x}`);
    assert.equal(body.y, 0.5);
  });

  it('steps up a one-block ledge automatically', () => {
    const w = floorWorld((world) => {
      for (let x = 3; x <= 5; x++) for (let z = -5; z <= 5; z++) world.set(x, 1, z, Block.Stone);
    });
    const body = createBody(0, 0.5, 0);
    for (let i = 0; i < 60 && body.x < 3.5; i++) stepPlayer(w, body, eastward, SIM_DT);
    run(w, body, idle, 30);
    assert.ok(body.x > 3, `x = ${body.x}`);
    assert.equal(body.y, 1.5);
  });

  it('jumps only when grounded', () => {
    const w = floorWorld();
    const body = createBody(0, 0.5, 0);
    run(w, body, idle, 2);
    stepPlayer(w, body, { ...idle, jump: true }, SIM_DT);
    assert.ok(body.vy > 0);
    const vy = body.vy;
    stepPlayer(w, body, { ...idle, jump: true }, SIM_DT);
    assert.ok(body.vy < vy, 'a second jump in mid-air must not add speed');
  });

  it('is deterministic: replaying the same inputs gives the same state', () => {
    const w = floorWorld((world) => world.set(2, 1, 1, Block.Stone));
    const inputs: MoveIntent[] = Array.from({ length: 50 }, (_, i) => ({
      fwd: Math.sin(i * 0.3), strafe: Math.cos(i * 0.2) * 0.5, yaw: i * 0.05, jump: i % 17 === 0, swim: false,
    }));
    const a = createBody(0, 2, 0);
    const b = createBody(0, 2, 0);
    for (const intent of inputs) stepPlayer(w, a, intent, SIM_DT);
    for (const intent of inputs) stepPlayer(w, b, intent, SIM_DT);
    assert.deepEqual(a, b);
  });

  it('swims upward while jump is held in water', () => {
    const w = floorWorld((world) => {
      for (let x = -5; x <= 5; x++) for (let z = -5; z <= 5; z++) for (let y = 1; y <= 4; y++) world.set(x, y, z, Block.Water);
    });
    const body = createBody(0, 0.5, 0);
    run(w, body, { ...idle, swim: true }, 10);
    assert.ok(body.y > 1.5, `y = ${body.y}`);
  });
});
