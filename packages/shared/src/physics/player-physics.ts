import { Block } from '../world/blocks';
import type { VoxelWorld } from '../world/voxel-world';

/** Fixed simulation step shared by client prediction and the server. */
export const SIM_DT = 1 / 20;

export const PHYSICS = {
  halfWidth: 0.3,
  height: 1.5,
  gravity: 27,
  jumpVelocity: 10.8,
  autoStepVelocity: 8.2,
  walkSpeed: 5.4,
  swimSpeed: 3.0,
  swimUpVelocity: 4.5,
  waterGravityScale: 0.45,
  maxFallSpeed: 34,
  maxSinkSpeed: 3.5,
  acceleration: 14,
  /** Below this height the player has fallen off the island. */
  killPlaneY: -40,
} as const;

export interface PhysicsBody {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  grounded: boolean;
}

/** One frame of player intent. `fwd`/`strafe` are in [-1, 1] relative to the camera `yaw`. */
export interface MoveIntent {
  readonly fwd: number;
  readonly strafe: number;
  readonly yaw: number;
  /** Jump was pressed this frame. */
  readonly jump: boolean;
  /** Jump is held (used to swim upward). */
  readonly swim: boolean;
}

export interface StepResult {
  /** World-space move direction (unnormalised) and its length; used to turn the character. */
  readonly moveX: number;
  readonly moveZ: number;
  readonly moveLength: number;
  readonly jumped: boolean;
  readonly inWater: boolean;
}

export const createBody = (x: number, y: number, z: number): PhysicsBody => ({ x, y, z, vx: 0, vy: 0, vz: 0, grounded: false });

export const copyBody = (from: PhysicsBody, to: PhysicsBody): void => {
  to.x = from.x; to.y = from.y; to.z = from.z;
  to.vx = from.vx; to.vy = from.vy; to.vz = from.vz;
  to.grounded = from.grounded;
};

const { halfWidth: HW, height: PH } = PHYSICS;

/** Does an axis-aligned player box with feet at (px, py, pz) overlap any solid block? */
export function boxHitsWorld(world: VoxelWorld, px: number, py: number, pz: number): boolean {
  const x0 = Math.floor(px - HW + 0.5 + 1e-6);
  const x1 = Math.ceil(px + HW - 0.5 - 1e-6);
  const y0 = Math.floor(py + 0.5 + 1e-6);
  const y1 = Math.ceil(py + PH - 0.5 - 1e-6);
  const z0 = Math.floor(pz - HW + 0.5 + 1e-6);
  const z1 = Math.ceil(pz + HW - 0.5 - 1e-6);
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      for (let z = z0; z <= z1; z++) if (world.isSolid(x, y, z)) return true;
    }
  }
  return false;
}

export const isBodyInWater = (world: VoxelWorld, body: PhysicsBody): boolean =>
  world.get(Math.round(body.x), Math.round(body.y + 0.3), Math.round(body.z)) === Block.Water;

/** Sweeps the body through the voxel grid one axis at a time, resolving collisions. */
function sweep(world: VoxelWorld, b: PhysicsBody, dt: number): { blockedX: boolean; blockedZ: boolean } {
  const steps = Math.max(1, Math.ceil((Math.max(Math.abs(b.vx), Math.abs(b.vy), Math.abs(b.vz)) * dt) / 0.25));
  const h = dt / steps;
  let blockedX = false;
  let blockedZ = false;
  b.grounded = false;
  for (let s = 0; s < steps; s++) {
    let nx = b.x + b.vx * h;
    if (boxHitsWorld(world, nx, b.y, b.z)) {
      const fx = b.vx > 0 ? Math.round(nx + HW) - 0.5 - HW - 1e-4 : Math.round(nx - HW) + 0.5 + HW + 1e-4;
      nx = boxHitsWorld(world, fx, b.y, b.z) ? b.x : fx;
      blockedX = true;
    }
    b.x = nx;

    let nz = b.z + b.vz * h;
    if (boxHitsWorld(world, b.x, b.y, nz)) {
      const fz = b.vz > 0 ? Math.round(nz + HW) - 0.5 - HW - 1e-4 : Math.round(nz - HW) + 0.5 + HW + 1e-4;
      nz = boxHitsWorld(world, b.x, b.y, fz) ? b.z : fz;
      blockedZ = true;
    }
    b.z = nz;

    let ny = b.y + b.vy * h;
    if (boxHitsWorld(world, b.x, ny, b.z)) {
      if (b.vy <= 0) {
        const fy = Math.round(ny) + 0.5;
        ny = boxHitsWorld(world, b.x, fy, b.z) ? b.y : fy;
        b.grounded = true;
      } else {
        const fy = Math.round(ny + PH) - 0.5 - PH - 1e-4;
        ny = boxHitsWorld(world, b.x, fy, b.z) ? b.y : fy;
      }
      b.vy = 0;
    }
    b.y = ny;
  }
  return { blockedX, blockedZ };
}

/**
 * Advances a player body by one step. Deterministic for a given world, body, intent and
 * `landSpeed` (a mount's multiplier on walking speed; swimming is never faster), which is what
 * makes client-side prediction and server authority agree.
 */
export function stepPlayer(world: VoxelWorld, body: PhysicsBody, intent: MoveIntent, dt: number, landSpeed = 1): StepResult {
  const inWater = isBodyInWater(world, body);
  const sy = Math.sin(intent.yaw);
  const cy = Math.cos(intent.yaw);
  const moveX = -sy * intent.fwd + cy * intent.strafe;
  const moveZ = -cy * intent.fwd - sy * intent.strafe;
  const speed = inWater ? PHYSICS.swimSpeed : PHYSICS.walkSpeed * landSpeed;
  const k = 1 - Math.exp(-PHYSICS.acceleration * dt);
  body.vx += (moveX * speed - body.vx) * k;
  body.vz += (moveZ * speed - body.vz) * k;

  let jumped = false;
  if (intent.jump && body.grounded) {
    body.vy = PHYSICS.jumpVelocity;
    jumped = true;
  }
  if (inWater && intent.swim) body.vy = Math.max(body.vy, PHYSICS.swimUpVelocity);
  body.vy -= PHYSICS.gravity * dt * (inWater ? PHYSICS.waterGravityScale : 1);
  body.vy = Math.max(body.vy, inWater ? -PHYSICS.maxSinkSpeed : -PHYSICS.maxFallSpeed);

  const wasGrounded = body.grounded;
  const { blockedX, blockedZ } = sweep(world, body, dt);
  const moveLength = Math.hypot(moveX, moveZ);

  // Walking into a one-block step (two blocks when swimming) hops up automatically.
  if ((body.grounded || wasGrounded || inWater) && moveLength > 0.1 && (blockedX || blockedZ) && body.vy <= 0.5) {
    const rise = inWater ? 2.05 : 1.05;
    const ahead = 0.4 / moveLength;
    if (!boxHitsWorld(world, body.x + moveX * ahead, body.y + rise, body.z + moveZ * ahead)) {
      body.vy = inWater ? PHYSICS.jumpVelocity : PHYSICS.autoStepVelocity;
    }
  }
  return { moveX, moveZ, moveLength, jumped, inWater };
}

/** Clamps untrusted intent values into their legal ranges. */
export function sanitizeIntent(fwd: number, strafe: number, yaw: number): { fwd: number; strafe: number; yaw: number } {
  let f = Number.isFinite(fwd) ? Math.max(-1, Math.min(1, fwd)) : 0;
  let s = Number.isFinite(strafe) ? Math.max(-1, Math.min(1, strafe)) : 0;
  const len = Math.hypot(f, s);
  if (len > 1) {
    f /= len;
    s /= len;
  }
  return { fwd: f, strafe: s, yaw: Number.isFinite(yaw) ? yaw : 0 };
}
