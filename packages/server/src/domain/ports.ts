import type { BoardId, PlayerProgress, StoredEntry } from '@lanternwood/shared';

/** Monotonic simulation time in seconds. */
export interface Clock {
  now(): number;
}

/** Calendar days for daily content such as bounties. */
export interface Calendar {
  /** Days since 1970-01-01 UTC. */
  today(): number;
  /** The current date and time as an ISO string, for records. */
  iso(): string;
}

/** A hero as stored between sessions. */
export interface PlayerRecord extends PlayerProgress {
  readonly accountId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Persistence port. Implementations live in infrastructure/persistence. */
export interface PlayerRepository {
  load(accountId: string): Promise<PlayerRecord | null>;
  save(record: PlayerRecord): Promise<void>;
}

/** Stored leaderboards, keyed by board. */
export type StoredBoards = Partial<Record<BoardId, StoredEntry[]>>;

/** Persistence port for the server-wide leaderboards. */
export interface LeaderboardRepository {
  load(): Promise<StoredBoards>;
  save(boards: StoredBoards): Promise<void>;
}
