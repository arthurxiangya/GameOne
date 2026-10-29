import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseBoards } from '../../domain/leaderboard-record';
import type { LeaderboardRepository, StoredBoards } from '../../domain/ports';

/** All leaderboards in one JSON file, written atomically (temp file, then rename). */
export class JsonFileLeaderboardRepository implements LeaderboardRepository {
  private readonly file: string;

  constructor(directory: string) {
    this.file = join(directory, 'leaderboards.json');
  }

  async load(): Promise<StoredBoards> {
    try {
      return parseBoards(JSON.parse(await readFile(this.file, 'utf8')));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
      throw err;
    }
  }

  async save(boards: StoredBoards): Promise<void> {
    const temp = `${this.file}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temp, `${JSON.stringify(boards, null, 2)}\n`, 'utf8');
    await rename(temp, this.file);
  }
}
