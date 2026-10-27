import type { PlayerRecord, PlayerRepository } from '../../domain/ports';

/** Volatile repository for tests and throwaway local servers. */
export class InMemoryPlayerRepository implements PlayerRepository {
  private readonly records = new Map<string, PlayerRecord>();

  async load(accountId: string): Promise<PlayerRecord | null> {
    const record = this.records.get(accountId);
    return record ? { ...record } : null;
  }

  async save(record: PlayerRecord): Promise<void> {
    this.records.set(record.accountId, { ...record });
  }

  get size(): number {
    return this.records.size;
  }
}
