import { BOARD_IDS, BOARD_SIZE, sanitizeName, type StoredEntry } from '@lanternwood/shared';
import type { StoredBoards } from './ports';

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Validates stored leaderboards, dropping anything malformed instead of failing. */
export function parseBoards(data: unknown): StoredBoards {
  const boards: StoredBoards = {};
  if (!isRecord(data)) return boards;
  for (const id of BOARD_IDS) {
    const raw = data[id];
    if (!Array.isArray(raw)) continue;
    const entries: StoredEntry[] = [];
    for (const e of raw.slice(0, BOARD_SIZE)) {
      if (!isRecord(e) || typeof e.key !== 'string' || e.key.length > 64 || typeof e.value !== 'number' || !Number.isFinite(e.value)) continue;
      const name = typeof e.name === 'string' ? sanitizeName(e.name) : null;
      if (!name) continue;
      const at = typeof e.at === 'string' && e.at.length <= 40 ? e.at : new Date(0).toISOString();
      const detail = typeof e.detail === 'string' ? e.detail.slice(0, 80) : undefined;
      entries.push(detail === undefined ? { key: e.key, name, value: e.value, at } : { key: e.key, name, value: e.value, at, detail });
    }
    boards[id] = entries;
  }
  return boards;
}
