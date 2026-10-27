import type { EntityState } from '@lanternwood/shared';
import { SnapshotBuffer, type Pose } from './snapshot-buffer';

export interface RemoteEntity {
  readonly id: number;
  /** Latest authoritative state. */
  state: EntityState;
  readonly buffer: SnapshotBuffer;
  /** Interpolated pose for the current frame. */
  readonly pose: Pose;
}

export interface StoreChanges {
  readonly added: readonly RemoteEntity[];
  readonly removed: readonly RemoteEntity[];
}

/** Everything the server says is near us, keyed by entity id. */
export class EntityStore {
  private readonly entities = new Map<number, RemoteEntity>();

  apply(states: readonly EntityState[], serverTime: number): StoreChanges {
    const added: RemoteEntity[] = [];
    const seen = new Set<number>();
    for (const state of states) {
      seen.add(state.id);
      let entity = this.entities.get(state.id);
      if (!entity) {
        entity = { id: state.id, state, buffer: new SnapshotBuffer(), pose: { x: state.x, y: state.y, z: state.z, yaw: state.yaw } };
        this.entities.set(state.id, entity);
        added.push(entity);
      }
      entity.state = state;
      entity.buffer.push({ t: serverTime, x: state.x, y: state.y, z: state.z, yaw: state.yaw });
    }
    const removed: RemoteEntity[] = [];
    for (const [id, entity] of this.entities) {
      if (!seen.has(id)) {
        this.entities.delete(id);
        removed.push(entity);
      }
    }
    return { added, removed };
  }

  /** Moves every entity's pose to the given (past) server time. */
  interpolate(serverTime: number): void {
    for (const e of this.entities.values()) e.buffer.sample(serverTime, e.pose);
  }

  get(id: number): RemoteEntity | undefined {
    return this.entities.get(id);
  }

  all(): IterableIterator<RemoteEntity> {
    return this.entities.values();
  }

  clear(): RemoteEntity[] {
    const all = [...this.entities.values()];
    this.entities.clear();
    return all;
  }
}
