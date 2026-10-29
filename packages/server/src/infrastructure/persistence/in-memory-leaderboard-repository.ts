import type { LeaderboardRepository, StoredBoards } from '../../domain/ports';

/** Leaderboards that last as long as the process. For tests, and single-player without storage. */
export class InMemoryLeaderboardRepository implements LeaderboardRepository {
  private boards: StoredBoards = {};

  async load(): Promise<StoredBoards> {
    return structuredClone(this.boards);
  }

  async save(boards: StoredBoards): Promise<void> {
    this.boards = structuredClone(boards);
  }
}
