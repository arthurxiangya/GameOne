import {
  CLASSES,
  classArmor,
  classMaxHp,
  createBody,
  loadout,
  maxResourceFor,
  powerFor,
  type ClassDef,
  type ClassId,
  type InputFrame,
  type Loadout,
  type LandmarkId,
  type MountId,
  type PhysicsBody,
  type Passive,
  type PlayerProgress,
  type SkillDef,
  type SkillId,
  type SpecDef,
  type SpecId,
  type TalentDef,
  type TalentPicks,
  type Vec3,
} from '@lanternwood/shared';
import { StatusList } from '../statuses';

/** A connected hero inside the simulation. */
export class Player {
  readonly body: PhysicsBody;
  /** Facing direction in radians (0 = +z). */
  yaw = Math.PI;
  hp: number;
  /** The class resource: Resolve, Mana, Focus or Heat. */
  mp: number;
  dead = false;
  lastHurtAt = Number.NEGATIVE_INFINITY;
  lastAttackAt = Number.NEGATIVE_INFINITY;
  /** Seconds until each skill is ready again; missing means ready. */
  readonly cooldowns = new Map<SkillId, number>();
  readonly statuses = new StatusList();
  /** Damage the current ward still absorbs, and when it fades. */
  shield = 0;
  shieldUntil = 0;

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
  /** The rift party the hero fights with, or null. */
  party: number | null = null;
  /** The last loadout, reused while class, level, spec and talent picks are unchanged (picks are replaced, never edited). */
  private memo: { cls: ClassId; level: number; spec: SpecId | undefined; picks: TalentPicks | undefined; value: Loadout } | null = null;
  /** In a duel, both heroes fight at the lower level: their health, resource and Power use this. */
  duelLevel: number | null = null;

  constructor(
    readonly id: number,
    readonly accountId: string,
    readonly look: number,
    readonly progress: PlayerProgress,
    spawn: Readonly<Vec3>,
  ) {
    this.body = createBody(spawn.x, spawn.y, spawn.z);
    this.hp = this.maxHp;
    this.mp = this.classDef.resource.startFull ? this.maxMp : 0;
  }

  get name(): string {
    return this.progress.name;
  }

  get level(): number {
    return this.progress.level;
  }

  /** The level the hero's stats come from: their own, or a duel's matched level. */
  get statLevel(): number {
    return this.duelLevel ?? this.progress.level;
  }

  get cls(): ClassId {
    return this.progress.cls;
  }

  get classDef(): ClassDef {
    return CLASSES[this.progress.cls];
  }

  /**
   * Spec, talents, skills and passive at the stat level. In a duel both heroes fight at the lower
   * level, so a spec or talent row the lower hero hasn't reached is off for both.
   */
  get loadout(): Loadout {
    const cls = this.progress.cls;
    const level = this.statLevel;
    const spec = this.progress.specs[cls];
    const picks = this.progress.talents[cls];
    const m = this.memo;
    if (m && m.cls === cls && m.level === level && m.spec === spec && m.picks === picks) return m.value;
    const value = loadout(cls, this.progress, level);
    this.memo = { cls, level, spec, picks, value };
    return value;
  }

  get spec(): SpecDef | null {
    return this.loadout.spec;
  }

  get talents(): readonly TalentDef[] {
    return this.loadout.talents;
  }

  get passive(): Passive {
    return this.loadout.passive;
  }

  /** The four class skills, with the spec's and talents' changes. */
  get kit(): readonly SkillDef[] {
    return this.loadout.kit;
  }

  get maxHp(): number {
    const l = this.loadout;
    return classMaxHp(this.progress.cls, this.statLevel, l.spec, l.talents);
  }

  /** Size of the class resource pool. */
  get maxMp(): number {
    return maxResourceFor(this.progress.cls, this.statLevel);
  }

  /** Power: every skill's numbers scale with it. */
  get attack(): number {
    return powerFor(this.statLevel, this.progress.weapon);
  }

  get armor(): number {
    const l = this.loadout;
    return classArmor(this.progress.cls, l.spec, l.talents);
  }

  cooldown(id: SkillId): number {
    return this.cooldowns.get(id) ?? 0;
  }

  /** Changes class and spec (`change` edits progress): fresh cooldowns, statuses and resource, same share of health. */
  switchClass(change: () => void): void {
    const share = this.hp / this.maxHp;
    change();
    this.cooldowns.clear();
    this.statuses.clear();
    this.shield = 0;
    this.hp = Math.max(1, Math.round(this.maxHp * share));
    this.mp = this.classDef.resource.startFull ? this.maxMp : 0;
  }

  touchProgress(): void {
    this.progressDirty = true;
  }

  /** Full health; pools that start full are refilled, the others (Resolve, Heat) are kept. */
  restoreVitals(): void {
    this.hp = this.maxHp;
    this.mp = this.classDef.resource.startFull ? this.maxMp : Math.min(this.mp, this.maxMp);
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
