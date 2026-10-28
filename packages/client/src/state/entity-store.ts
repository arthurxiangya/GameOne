import { isFullEntity, mergeEntityUpdate, type EntityState, type EntityUpdate } from '@lanternwood/shared';
import { SnapshotBuffer, type Pose } from './snapshot-buffer';

export interface RemoteEntity {
  readonly id: number;
  /** Latest authoritative state, with every delta applied. */
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

  /**
   * Applies one snapshot. New entities arrive in full, known ones as patches of what changed,
   * and an entity that changed nothing is simply absent; `gone` lists those that left.
   */
  apply(updates: readonly EntityUpdate[], gone: readonly number[], serverTime: number): StoreChanges {
    const added: RemoteEntity[] = [];
    for (const update of updates) {
      const existing = this.entities.get(update.id);
      if (existing) {
        const merged = mergeEntityUpdate(existing.state, update);
        if (merged) existing.state = merged;
      } else if (isFullEntity(update)) {
        const entity: RemoteEntity = {
          id: update.id,
          state: update,
          buffer: new SnapshotBuffer(),
          pose: { x: update.x, y: update.y, z: update.z, yaw: update.yaw },
        };
        this.entities.set(update.id, entity);
        added.push(entity);
      }
    }
    const removed: RemoteEntity[] = [];
    for (const id of gone) {
      const entity = this.entities.get(id);
      if (!entity) continue;
      this.entities.delete(id);
      removed.push(entity);
    }
    // Every entity still in view gets a sample, moving or not, so interpolation always has a
    // recent pair of samples and an entity that starts moving after standing still doesn't skip.
    for (const e of this.entities.values()) {
      e.buffer.push({ t: serverTime, x: e.state.x, y: e.state.y, z: e.state.z, yaw: e.state.yaw });
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
