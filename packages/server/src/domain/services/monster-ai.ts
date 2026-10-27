import { NO_GROUND, SLAM, damp, lerpAngle, outlevelledDamageMultiplier, type RandomSource } from '@lanternwood/shared';
import type { Monster } from '../entities/monster';
import type { Player } from '../entities/player';
import type { EventSink } from '../events';
import type { CombatService } from './combat-service';

/** What monster AI needs from the world. Implemented by the application layer. */
export interface AiWorld {
  surfaceY(x: number, z: number): number;
  player(id: number): Player | undefined;
  playersNear(x: number, z: number, radius: number): readonly Player[];
}

const MAX_CLIMB = 1.6;
const WANDER_RADIUS = 5;
/** Monsters only respawn when nobody is standing on their spawn point. */
const RESPAWN_CLEARANCE = 18;
/** Monsters ignore players this many levels above them. */
const IGNORE_LEVEL_GAP = 7;

/** Idle wandering, aggro, threat-based targeting, leashing, attacks and the boss slam. */
export class MonsterAi {
  constructor(
    private readonly world: AiWorld,
    private readonly combat: CombatService,
    private readonly events: EventSink,
    private readonly rng: RandomSource,
  ) {}

  update(m: Monster, dt: number): void {
    if (!m.alive) {
      this.updateDead(m, dt);
      return;
    }
    m.moving = false;
    this.updateSlam(m, dt);
    const target = this.selectTarget(m);
    if (m.mode === 'chase' && (!target || m.distanceFromSpawn > m.def.leash)) {
      m.mode = 'return';
      m.targetId = null;
      m.threat.clear();
    }
    if (m.mode === 'chase' && target) this.chase(m, target, dt);
    else if (m.mode === 'return') this.goHome(m, dt);
    else this.wander(m, dt);

    const ground = this.world.surfaceY(m.x, m.z);
    if (ground !== NO_GROUND) m.y += (ground - m.y) * Math.min(1, dt * 12);
  }

  private updateDead(m: Monster, dt: number): void {
    m.deadFor += dt;
    m.respawnIn -= dt;
    if (m.respawnIn > 0) return;
    const blocked = this.world.playersNear(m.spawnX, m.spawnZ, RESPAWN_CLEARANCE).length > 0;
    if (!blocked) m.respawn(this.world.surfaceY(m.spawnX, m.spawnZ));
  }

  private selectTarget(m: Monster): Player | null {
    if (m.mode === 'idle' && !m.def.passive) {
      let nearest: Player | null = null;
      let nearestDistance = Number.POSITIVE_INFINITY;
      for (const p of this.world.playersNear(m.x, m.z, m.def.aggroRange)) {
        if (p.dead || Math.abs(p.body.y - m.y) > 5 || p.level >= m.level + IGNORE_LEVEL_GAP) continue;
        const d = Math.hypot(p.body.x - m.x, p.body.z - m.z);
        if (d < nearestDistance) {
          nearestDistance = d;
          nearest = p;
        }
      }
      if (nearest) {
        m.addThreat(nearest.id, 1);
        m.mode = 'chase';
      }
    }
    if (m.mode !== 'chase') return null;

    let target: Player | null = null;
    let topThreat = Number.NEGATIVE_INFINITY;
    for (const [id, threat] of m.threat) {
      const p = this.world.player(id);
      if (!p || p.dead || Math.hypot(p.body.x - m.x, p.body.z - m.z) > m.def.leash + 12) {
        m.threat.delete(id);
        continue;
      }
      if (threat > topThreat) {
        topThreat = threat;
        target = p;
      }
    }
    m.targetId = target ? target.id : null;
    return target;
  }

  private chase(m: Monster, target: Player, dt: number): void {
    const dx = target.body.x - m.x;
    const dz = target.body.z - m.z;
    const dist = Math.hypot(dx, dz) || 1;
    const gap = dist - m.bodyRadius;
    const dy = Math.abs(target.body.y - m.y);
    const reach = m.attackReach;
    if (gap > reach * 0.9) this.moveToward(m, dx / dist, dz / dist, m.def.speed, dt);
    m.yaw = lerpAngle(m.yaw, Math.atan2(dx, dz), damp(10, dt));

    m.attackCooldown -= dt;
    if (m.windup > 0) {
      m.windup -= dt;
      if (m.windup <= 0 && gap < reach + 0.9 && dy < 2.6) {
        const roll = 0.85 + this.rng.next() * 0.3;
        this.combat.damagePlayer(target, m.damage * roll * outlevelledDamageMultiplier(m.level, target.level), m, 'hit');
      }
    } else if (gap <= reach + 0.2 && m.attackCooldown <= 0) {
      m.windup = m.def.windup;
      m.attackCooldown = m.def.attackInterval;
    }

    if (m.def.boss) {
      m.slamCooldown -= dt;
      if (m.slamCooldown <= 0 && !m.slam && gap < SLAM.triggerRange) this.startSlam(m);
    }
  }

  private wander(m: Monster, dt: number): void {
    m.wanderTimer -= dt;
    if (m.wanderTimer <= 0) {
      const a = this.rng.next() * Math.PI * 2;
      const r = this.rng.next() * WANDER_RADIUS;
      m.wanderX = m.spawnX + Math.cos(a) * r;
      m.wanderZ = m.spawnZ + Math.sin(a) * r;
      m.wanderTimer = 3 + this.rng.next() * 5;
    }
    const dx = m.wanderX - m.x;
    const dz = m.wanderZ - m.z;
    const d = Math.hypot(dx, dz);
    if (d > 0.3) this.moveToward(m, dx / d, dz / d, m.def.speed * 0.45, dt);
    m.hp = Math.min(m.maxHp, m.hp + m.maxHp * 0.08 * dt);
  }

  private goHome(m: Monster, dt: number): void {
    const dx = m.spawnX - m.x;
    const dz = m.spawnZ - m.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.6) {
      m.mode = 'idle';
      m.wanderTimer = 1;
    } else {
      this.moveToward(m, dx / d, dz / d, m.def.speed * 1.35, dt);
    }
    m.windup = 0;
    m.hp = Math.min(m.maxHp, m.hp + m.maxHp * 0.5 * dt);
  }

  private moveToward(m: Monster, ux: number, uz: number, speed: number, dt: number): void {
    const nx = m.x + ux * speed * dt;
    const nz = m.z + uz * speed * dt;
    const ground = this.world.surfaceY(nx, nz);
    if (ground !== NO_GROUND && ground - m.y < MAX_CLIMB) {
      m.x = nx;
      m.z = nz;
      m.moving = true;
    }
    if (m.mode !== 'chase') m.yaw = lerpAngle(m.yaw, Math.atan2(ux, uz), damp(8, dt));
  }

  private startSlam(m: Monster): void {
    m.slam = { x: m.x, y: m.y, z: m.z, remaining: SLAM.delay };
    m.slamCooldown = SLAM.cooldown + this.rng.next() * 2;
    this.events.area(m.x, m.z, { e: 'slamWarn', x: m.x, y: m.y, z: m.z, r: SLAM.radius, delay: SLAM.delay });
  }

  private updateSlam(m: Monster, dt: number): void {
    if (!m.slam) return;
    m.slam.remaining -= dt;
    if (m.slam.remaining > 0) return;
    const { x, y, z } = m.slam;
    m.slam = null;
    this.events.area(x, z, { e: 'slam', x, y, z, r: SLAM.radius });
    for (const p of this.world.playersNear(x, z, SLAM.radius)) {
      if (!p.dead && Math.abs(p.body.y - y) < 4) this.combat.damagePlayer(p, SLAM.damage + this.rng.next() * 12, m, 'slam');
    }
  }
}
