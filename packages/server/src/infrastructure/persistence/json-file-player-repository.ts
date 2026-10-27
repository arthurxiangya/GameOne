import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parsePlayerRecord } from '../../domain/player-record';
import type { PlayerRecord, PlayerRepository } from '../../domain/ports';

const ACCOUNT_ID = /^[a-f0-9]{24,64}$/;

/**
 * Stores each hero as one JSON file. Writes go to a temp file and are renamed into place,
 * so a crash never leaves a half-written save, and writes for one account are serialised.
 * Good for a single server process; swap in a database adapter to scale out.
 */
export class JsonFilePlayerRepository implements PlayerRepository {
  private readonly writes = new Map<string, Promise<void>>();

  constructor(private readonly directory: string) {}

  async init(): Promise<void> {
    await mkdir(this.directory, { recursive: true });
  }

  async load(accountId: string): Promise<PlayerRecord | null> {
    let text: string;
    try {
      text = await readFile(this.pathFor(accountId), 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
    const record = parsePlayerRecord(JSON.parse(text));
    if (!record || record.accountId !== accountId) throw new Error(`Save file for ${accountId.slice(0, 8)} is invalid`);
    return record;
  }

  save(record: PlayerRecord): Promise<void> {
    const file = this.pathFor(record.accountId);
    const previous = this.writes.get(record.accountId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(() => this.writeAtomically(file, record));
    this.writes.set(record.accountId, next);
    const cleanup = (): void => {
      if (this.writes.get(record.accountId) === next) this.writes.delete(record.accountId);
    };
    next.then(cleanup, cleanup);
    return next;
  }

  private pathFor(accountId: string): string {
    if (!ACCOUNT_ID.test(accountId)) throw new Error('Invalid account id');
    return join(this.directory, `${accountId}.json`);
  }

  private async writeAtomically(file: string, record: PlayerRecord): Promise<void> {
    const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temp, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
    await rename(temp, file);
  }
}
