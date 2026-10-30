import {
  CLASSES,
  createBody,
  heroStats,
  maxResourceFor,
  type ClassDef,
  type ClassId,
  type Equipped,
  type GearProc,
  type HeroStats,
  type InputFrame,
  type LegendaryDef,
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
  /**
   * The last stats, reused while class, level, spec, talent picks and gear are unchanged (picks
   * and gear are replaced, never edited, so comparing references is enough).
   */
  private memo: { cls: ClassId; level: number; duel: boolean; spec: SpecId | undefined; picks: TalentPicks | undefined; gear: Equipped; value: HeroStats } | null = null;
  /** Uses of the legendary's echo skill so far (Pip's Lucky Quiver counts Quick Shots). */
  echoCount = 0;
  /** Simulation time when a low-health shield (Frostward) can fire again. */
  wardReadyAt = 0;
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
   * Class, spec, talents and gear at the stat level. In a duel both heroes fight at the lower
   * level, so a spec or talent row the lower hero hasn't reached is off for both, and gear counts
   * at no more than that level's item level.
   */
  get stats(): HeroStats {
    const p = this.progress;
    const cls = p.cls;
    const level = this.statLevel;
    const duel = this.duelLevel !== null;
    const spec = p.specs[cls];
    const picks = p.talents[cls];
    const m = this.memo;
    if (m && m.cls === cls && m.level === level && m.duel === duel && m.spec === spec && m.picks === picks && m.gear === p.gear) return m.value;
    const value = heroStats(p, level, duel);
    this.memo = { cls, level, duel, spec, picks, gear: p.gear, value };
    return value;
  }

  get loadout(): Loadout {
    return this.stats.loadout;
  }

  get spec(): SpecDef | null {
    return this.loadout.spec;
  }

  get talents(): readonly TalentDef[] {
    return this.loadout.talents;
  }

  /** Spec, talents, legendary and gear passives together. */
  get passive(): Passive {
    return this.stats.passive;
  }

  /** The four class skills, with the spec's, talents' and legendary's changes. */
  get kit(): readonly SkillDef[] {
    return this.loadout.kit;
  }

  /** The legendary worn, when its spec is active. */
  get legendary(): LegendaryDef | null {
    return this.stats.gear.legendary && this.loadout.legendary ? this.stats.gear.legendary : null;
  }

  /** Set bonuses that need the engine: Frostward, Emberfall, Bellsong. */
  get procs(): readonly GearProc[] {
    return this.stats.gear.procs;
  }

  get maxHp(): number {
    return this.stats.maxHp;
  }

  /** Size of the class resource pool. */
  get maxMp(): number {
    return maxResourceFor(this.progress.cls, this.statLevel);
  }

  /** Power: every skill's numbers scale with it. */
  get attack(): number {
    return this.stats.power;
  }

  get armor(): number {
    return this.stats.armor;
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

  /** Changes gear (`change` replaces `progress.gear`), keeping the same share of health. */
  changeGear(change: () => void): void {
    const share = this.hp / this.maxHp;
    change();
    this.hp = Math.max(1, Math.min(this.maxHp, Math.round(this.maxHp * share)));
    this.echoCount = 0;
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
