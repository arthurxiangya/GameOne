import type { EntityState, GameEvent, SelfState, SnapshotMessage } from '@lanternwood/shared';
import type { Monster } from '../domain/entities/monster';
import type { Player } from '../domain/entities/player';
import type { GameWorld } from './game-world';

const r2 = (v: number): number => Math.round(v * 100) / 100;
const r3 = (v: number): number => Math.round(v * 1000) / 1000;
/** Dead monsters stay in snapshots briefly so clients can play the death animation. */
const CORPSE_SECONDS = 1.5;

/** Builds each player's view of the world: themselves in full, everyone nearby in brief. */
export class SnapshotBuilder {
  constructor(
    private readonly world: GameWorld,
    private readonly interestRadius: number,
  ) {}

  build(viewer: Player, events: readonly GameEvent[]): SnapshotMessage {
    const { x, z } = viewer.body;
    const ents: EntityState[] = [];
    for (const p of this.world.playersNear(x, z, this.interestRadius)) {
      if (p !== viewer) ents.push(this.encodePlayer(p));
    }
    for (const m of this.world.monstersNear(x, z, this.interestRadius)) {
      if (m.alive || m.deadFor < CORPSE_SECONDS) ents.push(this.encodeMonster(m));
    }
    return {
      t: 'snapshot',
      tick: this.world.tick,
      st: r3(this.world.time),
      day: Math.round(this.world.timeOfDay * 10000) / 10000,
      ack: viewer.lastInputSeq,
      you: this.encodeSelf(viewer),
      ents,
      ev: events,
    };
  }

  /** Full precision: the client replays its prediction on top of these exact values. */
  private encodeSelf(p: Player): SelfState {
    const b = p.body;
    return {
      x: b.x, y: b.y, z: b.z, vx: b.vx, vy: b.vy, vz: b.vz, g: b.grounded,
      hp: Math.ceil(p.hp), mhp: p.maxHp, mp: Math.floor(p.mp), mmp: p.maxMp, dead: p.dead,
      cd: { ...p.cooldowns },
    };
  }

  private encodePlayer(p: Player): EntityState {
    return {
      k: 'p', id: p.id, x: r2(p.body.x), y: r2(p.body.y), z: r2(p.body.z), yaw: r2(p.yaw),
      hp: Math.ceil(p.hp), mhp: p.maxHp, lv: p.level, nm: p.name, look: p.look, dead: p.dead,
    };
  }

  private encodeMonster(m: Monster): EntityState {
    return {
      k: 'm', id: m.id, x: r2(m.x), y: r2(m.y), z: r2(m.z), yaw: r2(m.yaw),
      hp: Math.max(0, Math.ceil(m.hp)), mhp: m.maxHp, lv: m.level, ty: m.type, sc: r2(m.scale), st: this.world.monsterAnim(m),
    };
  }
}
