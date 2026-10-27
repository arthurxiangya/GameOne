import {
  SIM_DT,
  copyBody,
  createBody,
  stepPlayer,
  type InputFrame,
  type MoveIntent,
  type PhysicsBody,
  type SelfState,
  type Vec3,
  type VoxelWorld,
} from '@lanternwood/shared';

/** Errors larger than this are teleports (respawn, fall rescue) and snap instead of smoothing. */
const SNAP_DISTANCE = 4;
const MAX_PENDING = 120;

/**
 * Client-side prediction for the local hero. Inputs are applied immediately with the same
 * physics the server runs; when a snapshot arrives the server state is adopted and every
 * input it has not processed yet is replayed on top. Small corrections are smoothed out
 * visually so the camera never jerks.
 */
export class LocalPlayer {
  readonly body: PhysicsBody = createBody(0, 0, 0);
  private readonly previous: PhysicsBody = createBody(0, 0, 0);
  private readonly pending: InputFrame[] = [];
  private readonly correction: Vec3 = { x: 0, y: 0, z: 0 };
  private seq = 0;
  /** Facing direction for rendering. */
  yaw = Math.PI;

  constructor(private world: VoxelWorld) {}

  setWorld(world: VoxelWorld): void {
    this.world = world;
  }

  /** Places the hero without any history, e.g. right after joining. */
  reset(at: Vec3): void {
    Object.assign(this.body, { x: at.x, y: at.y, z: at.z, vx: 0, vy: 0, vz: 0, grounded: false });
    copyBody(this.body, this.previous);
    this.pending.length = 0;
    this.correction.x = this.correction.y = this.correction.z = 0;
  }

  get unacknowledged(): number {
    return this.pending.length;
  }

  /** Simulates one fixed step locally and returns the frame to send to the server. */
  step(intent: MoveIntent): InputFrame {
    copyBody(this.body, this.previous);
    const frame: InputFrame = { seq: ++this.seq, fwd: intent.fwd, strafe: intent.strafe, yaw: intent.yaw, jump: intent.jump, swim: intent.swim };
    const result = stepPlayer(this.world, this.body, intent, SIM_DT);
    if (result.moveLength > 0.1) this.yaw = Math.atan2(result.moveX, result.moveZ);
    this.pending.push(frame);
    if (this.pending.length > MAX_PENDING) this.pending.shift();
    return frame;
  }

  /** Adopts authoritative state and replays inputs the server has not seen yet. */
  reconcile(server: SelfState, ack: number): void {
    while (this.pending.length > 0 && this.pending[0]!.seq <= ack) this.pending.shift();
    const bx = this.body.x;
    const by = this.body.y;
    const bz = this.body.z;
    Object.assign(this.body, { x: server.x, y: server.y, z: server.z, vx: server.vx, vy: server.vy, vz: server.vz, grounded: server.g });
    for (const f of this.pending) stepPlayer(this.world, this.body, f, SIM_DT);

    const dx = this.body.x - bx;
    const dy = this.body.y - by;
    const dz = this.body.z - bz;
    if (Math.hypot(dx, dy, dz) > SNAP_DISTANCE) {
      copyBody(this.body, this.previous);
      this.correction.x = this.correction.y = this.correction.z = 0;
      return;
    }
    // Shift the render history by the same amount and remember the jump as an offset to fade out.
    this.previous.x += dx;
    this.previous.y += dy;
    this.previous.z += dz;
    this.correction.x -= dx;
    this.correction.y -= dy;
    this.correction.z -= dz;
  }

  /** Render position between the last two steps (`alpha` in [0, 1]) plus any fading correction. */
  renderPosition(alpha: number, dt: number, out: Vec3): Vec3 {
    const fade = Math.exp(-12 * dt);
    this.correction.x *= fade;
    this.correction.y *= fade;
    this.correction.z *= fade;
    out.x = this.previous.x + (this.body.x - this.previous.x) * alpha + this.correction.x;
    out.y = this.previous.y + (this.body.y - this.previous.y) * alpha + this.correction.y;
    out.z = this.previous.z + (this.body.z - this.previous.z) * alpha + this.correction.z;
    return out;
  }
}
