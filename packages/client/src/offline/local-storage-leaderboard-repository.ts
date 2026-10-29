import { parseBoards, type LeaderboardRepository, type StoredBoards } from '@lanternwood/server/embedded';
import type { KeyValueStorage } from './local-storage-player-repository';

const KEY = 'lanternwood.offline.leaderboards';

/** Single-player leaderboards in this browser's localStorage (your own best runs). */
export class LocalStorageLeaderboardRepository implements LeaderboardRepository {
  private memory: StoredBoards = {};

  constructor(private readonly storage: KeyValueStorage | null) {}

  async load(): Promise<StoredBoards> {
    try {
      const text = this.storage?.getItem(KEY);
      return text ? parseBoards(JSON.parse(text)) : this.memory;
    } catch {
      return this.memory;
    }
  }

  async save(boards: StoredBoards): Promise<void> {
    this.memory = boards;
    try {
      this.storage?.setItem(KEY, JSON.stringify(boards));
    } catch {
      // Storage full or blocked: the in-memory copy lasts for this session.
    }
  }
}
