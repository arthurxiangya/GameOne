import { parsePlayerRecord, type PlayerRecord, type PlayerRepository } from '@lanternwood/server/embedded';

const PREFIX = 'lanternwood.offline.hero.';

export type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem'>;

/**
 * Single-player saves, kept in this browser's localStorage. Falls back to memory when storage
 * is unavailable (private windows, blocked site data), so the game still runs for the session.
 * A save that fails validation is ignored and replaced by a fresh hero rather than blocking play.
 */
export class LocalStoragePlayerRepository implements PlayerRepository {
  private readonly memory = new Map<string, PlayerRecord>();

  constructor(private readonly storage: KeyValueStorage | null) {}

  async load(accountId: string): Promise<PlayerRecord | null> {
    const text = this.read(PREFIX + accountId);
    if (text === null) return this.memory.get(accountId) ?? null;
    try {
      return parsePlayerRecord(JSON.parse(text));
    } catch {
      return null;
    }
  }

  async save(record: PlayerRecord): Promise<void> {
    this.memory.set(record.accountId, record);
    try {
      this.storage?.setItem(PREFIX + record.accountId, JSON.stringify(record));
    } catch {
      // Quota exceeded or storage blocked: the in-memory copy still lasts for this session.
    }
  }

  private read(key: string): string | null {
    try {
      return this.storage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  }
}

/** localStorage, or null where the browser refuses access to it. */
export function browserStorage(): KeyValueStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
