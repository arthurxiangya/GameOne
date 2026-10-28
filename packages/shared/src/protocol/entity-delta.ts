import { isFullEntity, type EntityState, type EntityUpdate } from './messages';

/** Applies one entity update on top of what was known about that entity. */
export function mergeEntityUpdate(previous: EntityState | undefined, update: EntityUpdate): EntityState | undefined {
  if (isFullEntity(update)) return update;
  return previous ? ({ ...previous, ...update } as EntityState) : undefined;
}

/** Folds a snapshot's `ents` and `gone` into a map of everything currently in view. */
export function applyEntityUpdates(known: Map<number, EntityState>, ents: readonly EntityUpdate[], gone: readonly number[]): void {
  for (const update of ents) {
    const merged = mergeEntityUpdate(known.get(update.id), update);
    if (merged) known.set(update.id, merged);
  }
  for (const id of gone) known.delete(id);
}
