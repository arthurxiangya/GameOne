import {
  SKILL_IDS,
  attackFor,
  createBody,
  maxHpFor,
  maxMpFor,
  type InputFrame,
  type LandmarkId,
  type MountId,
  type PhysicsBody,
  type PlayerProgress,
  type SkillId,
  type Vec3,
} from '@lanternwood/shared';

/** A connected hero inside the simulation. */
export class Player {
  readonly body: PhysicsBody;
  /** Facing direction in radians (0 = +z). */
  yaw = Math.PI;
  hp: number;
  mp: number;
  dead = false;
  lastHurtAt = Number.NEGATIVE_INFINITY;
  lastAttackAt = Number.NEGATIVE_INFINITY;
  readonly cooldowns: Record<SkillId, number>;

  /** Movement frames waiting to be simulated, in arrival order. */
  readonly inputQueue: InputFrame[] = [];
  /** Frames the player may still simulate; refilled at real-time rate to stop speed hacks. */
  inputCredit = 0;
  lastInputSeq = 0;
  /** Set when persistent progress changed and the client needs a fresh copy. */
  progressDirty = true;
  /** Set when the hero's mode state changed and their client needs it. */
  modeDirty = false;
  /** The landmark the hero is standing at, so arriving counts once. */
  atLandmark: LandmarkId | null = null;
  /** The mount being ridden. Not saved: heroes always rejoin on foot. */
  riding: MountId | null = null;
  /** Seconds left calling a mount, or 0. */
  calling = 0;
  /** Simulation time until which the Lantern's Blessing adds kill XP. */
  blessedUntil = 0;

  constructor(
    readonly id: number,
    readonly accountId: string,
    readonly look: number,
    readonly progress: PlayerProgress,
    spawn: Readonly<Vec3>,
  ) {
    this.body = createBody(spawn.x, spawn.y, spawn.z);
    this.hp = this.maxHp;
    this.mp = this.maxMp;
    this.cooldowns = Object.fromEntries(SKILL_IDS.map((id) => [id, 0])) as Record<SkillId, number>;
  }

  get name(): string {
    return this.progress.name;
  }

  get level(): number {
    return this.progress.level;
  }

  get maxHp(): number {
    return maxHpFor(this.progress.level);
  }

  get maxMp(): number {
    return maxMpFor(this.progress.level);
  }

  get attack(): number {
    return attackFor(this.progress.level, this.progress.weapon);
  }

  touchProgress(): void {
    this.progressDirty = true;
  }

  restoreVitals(): void {
    this.hp = this.maxHp;
    this.mp = this.maxMp;
  }

  /** Back on foot, and any mount call cancelled. Returns true if anything changed. */
  dismount(): boolean {
    const changed = this.riding !== null || this.calling > 0;
    this.riding = null;
    this.calling = 0;
    return changed;
  }

  teleport(to: Readonly<Vec3>): void {
    this.dismount();
    Object.assign(this.body, { x: to.x, y: to.y + 0.05, z: to.z, vx: 0, vy: 0, vz: 0, grounded: false });
    this.yaw = Math.PI;
  }
}
