import { MONSTERS, monsterDamage, monsterMaxHp, type MonsterDef, type MonsterType } from '@lanternwood/shared';

export type MonsterMode = 'idle' | 'chase' | 'return' | 'dead';

export interface PendingSlam {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  remaining: number;
}

export class Monster {
  readonly def: MonsterDef;
  readonly maxHp: number;
  readonly damage: number;
  x: number;
  y: number;
  z: number;
  yaw = 0;
  hp: number;
  mode: MonsterMode = 'idle';
  moving = false;
  wanderTimer = 0;
  wanderX: number;
  wanderZ: number;
  attackCooldown = 0;
  windup = 0;
  slamCooldown = 5;
  slam: PendingSlam | null = null;
  respawnIn = 0;
  deadFor = 0;
  targetId: number | null = null;
  /** Damage dealt per player; the monster fights whoever has the most. */
  readonly threat = new Map<number, number>();

  constructor(
    readonly id: number,
    readonly type: MonsterType,
    readonly level: number,
    readonly spawnX: number,
    readonly spawnZ: number,
    spawnY: number,
    readonly scale: number,
  ) {
    this.def = MONSTERS[type];
    this.maxHp = monsterMaxHp(type, level);
    this.damage = monsterDamage(type, level);
    this.hp = this.maxHp;
    this.x = spawnX;
    this.y = spawnY;
    this.z = spawnZ;
    this.wanderX = spawnX;
    this.wanderZ = spawnZ;
  }

  get alive(): boolean {
    return this.mode !== 'dead';
  }

  /** Radius used when measuring reach to this monster. */
  get bodyRadius(): number {
    return this.def.radius * this.scale * 0.6;
  }

  get attackReach(): number {
    return this.def.reach * (this.def.scale ? 1 : this.scale);
  }

  get distanceFromSpawn(): number {
    return Math.hypot(this.x - this.spawnX, this.z - this.spawnZ);
  }

  addThreat(playerId: number, amount: number): void {
    this.threat.set(playerId, (this.threat.get(playerId) ?? 0) + amount);
  }

  /** Being hit wakes a passive or returning monster. */
  provoke(): void {
    if (this.mode === 'idle' || (this.mode === 'return' && this.distanceFromSpawn < 12)) this.mode = 'chase';
  }

  die(): void {
    this.mode = 'dead';
    this.hp = 0;
    this.windup = 0;
    this.slam = null;
    this.targetId = null;
    this.threat.clear();
    this.deadFor = 0;
    this.respawnIn = this.def.respawnSeconds;
  }

  respawn(groundY: number): void {
    this.mode = 'idle';
    this.hp = this.maxHp;
    this.x = this.spawnX;
    this.z = this.spawnZ;
    this.y = groundY;
    this.wanderTimer = 2;
    this.attackCooldown = 0;
    this.slamCooldown = 5;
  }
}
