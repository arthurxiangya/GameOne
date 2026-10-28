import type { EntityState, EntityUpdate, GameEvent, SelfState, SnapshotMessage } from '@lanternwood/shared';
import type { Monster } from '../domain/entities/monster';
import type { Player } from '../domain/entities/player';
import type { GameWorld } from './game-world';

const r2 = (v: number): number => Math.round(v * 100) / 100;
const r3 = (v: number): number => Math.round(v * 1000) / 1000;
/** Dead monsters stay in snapshots briefly so clients can play the death animation. */
const CORPSE_SECONDS = 1.5;

/**
 * Builds each player's view of the world: themselves in full, everyone nearby as deltas.
 * For every viewer it remembers what that viewer was last sent, so an entity appears in full
 * once, then only as the fields that changed, and not at all while it stands still. Call
 * `build` only for snapshots that are actually sent, and `forget` when the viewer leaves.
 */
export class SnapshotBuilder {
  private readonly sent = new Map<number, Map<number, EntityState>>();

  constructor(
    private readonly world: GameWorld,
    private readonly interestRadius: number,
  ) {}

  build(viewer: Player, events: readonly GameEvent[]): SnapshotMessage {
    let known = this.sent.get(viewer.id);
    if (!known) {
      known = new Map();
      this.sent.set(viewer.id, known);
    }
    const { x, z } = viewer.body;
    const ents: EntityUpdate[] = [];
    const visible = new Set<number>();
    const include = (state: EntityState): void => {
      visible.add(state.id);
      const update = diff(known.get(state.id), state);
      if (update) ents.push(update);
      known.set(state.id, state);
    };
    for (const p of this.world.playersNear(x, z, this.interestRadius)) if (p !== viewer) include(this.encodePlayer(p));
    for (const m of this.world.monstersNear(x, z, this.interestRadius)) {
      if (m.alive || m.deadFor < CORPSE_SECONDS) include(this.encodeMonster(m));
    }
    const gone: number[] = [];
    for (const id of known.keys()) {
      if (!visible.has(id)) {
        gone.push(id);
        known.delete(id);
      }
    }
    return {
      t: 'snapshot',
      tick: this.world.tick,
      st: r3(this.world.time),
      day: Math.round(this.world.timeOfDay * 10000) / 10000,
      ack: viewer.lastInputSeq,
      you: this.encodeSelf(viewer),
      ents,
      gone,
      ev: events,
    };
  }

  forget(viewerId: number): void {
    this.sent.delete(viewerId);
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

/** The full state for a newcomer, the changed fields for a known entity, or null if nothing changed. */
function diff(previous: EntityState | undefined, next: EntityState): EntityUpdate | null {
  if (!previous || previous.k !== next.k) return next;
  const before = previous as unknown as Record<string, unknown>;
  const after = next as unknown as Record<string, unknown>;
  const patch: Record<string, unknown> = { id: next.id };
  let changed = false;
  for (const key of Object.keys(after)) {
    if (before[key] !== after[key]) {
      patch[key] = after[key];
      changed = true;
    }
  }
  return changed ? (patch as unknown as EntityUpdate) : null;
}
