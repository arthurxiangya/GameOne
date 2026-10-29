import { BOARD_IDS, placeOnBoard, type Board, type BoardId, type StoredEntry } from '@lanternwood/shared';
import type { LeaderboardRepository, StoredBoards } from '../domain/ports';
import type { Logger } from './ports';

/** Where modes report results. Returns the place on the board (1-based), or null. */
export interface LeaderboardSink {
  submit(board: BoardId, entry: StoredEntry): number | null;
}

/**
 * The server-wide leaderboards, kept in memory and written through the repository after each
 * change. Saves are serialised; a failed save is logged and the next change tries again.
 */
export class Leaderboards implements LeaderboardSink {
  private boards: Record<BoardId, StoredEntry[]> = { race: [], rift: [], duel: [] };
  private saving: Promise<void> = Promise.resolve();

  constructor(
    private readonly repository: LeaderboardRepository,
    private readonly logger: Logger,
  ) {}

  /** Merges stored boards in, so results submitted before loading finished are kept. */
  async load(): Promise<void> {
    let stored: StoredBoards;
    try {
      stored = await this.repository.load();
    } catch (err) {
      this.logger.error('failed to load leaderboards', { error: err instanceof Error ? err.message : String(err) });
      return;
    }
    let merged = false;
    for (const id of BOARD_IDS) {
      for (const entry of stored[id] ?? []) {
        const result = placeOnBoard(id, this.boards[id], entry);
        this.boards[id] = result.entries;
        merged ||= result.place !== null;
      }
    }
    // A result submitted while loading was saved without the stored ones; save the merge.
    if (merged) this.persist();
  }

  submit(board: BoardId, entry: StoredEntry): number | null {
    const { entries, place } = placeOnBoard(board, this.boards[board], entry);
    if (place === null) return null;
    this.boards[board] = entries;
    this.persist();
    return place;
  }

  /** The boards as clients see them: no owner keys. */
  snapshot(): Board[] {
    return BOARD_IDS.map((id) => ({ id, entries: this.boards[id].map(({ key: _key, ...rest }) => rest) }));
  }

  /** Resolves once every save started so far has finished. */
  flush(): Promise<void> {
    return this.saving;
  }

  private persist(): void {
    const copy: StoredBoards = { race: [...this.boards.race], rift: [...this.boards.rift], duel: [...this.boards.duel] };
    this.saving = this.saving
      .then(() => this.repository.save(copy))
      .catch((err: unknown) => this.logger.error('failed to save leaderboards', { error: err instanceof Error ? err.message : String(err) }));
  }
}
