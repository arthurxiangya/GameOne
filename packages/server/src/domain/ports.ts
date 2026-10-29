import type { PlayerProgress } from '@lanternwood/shared';

/** Monotonic simulation time in seconds. */
export interface Clock {
  now(): number;
}

/** Calendar days for daily content such as bounties. */
export interface Calendar {
  /** Days since 1970-01-01 UTC. */
  today(): number;
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
