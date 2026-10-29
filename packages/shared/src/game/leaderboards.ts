/** Server-wide best results. Entries are sent to clients without their owner key. */
export type BoardId = 'race' | 'rift' | 'duel';

export interface BoardDef {
  readonly title: string;
  /** How to show a value. */
  readonly unit: 'time' | 'points' | 'rating';
  readonly lowerIsBetter: boolean;
}

export const BOARDS: Readonly<Record<BoardId, BoardDef>> = {
  race: { title: 'Ember Run', unit: 'time', lowerIsBetter: true },
  rift: { title: 'Rift Trials', unit: 'points', lowerIsBetter: false },
  duel: { title: 'Duel Ring', unit: 'rating', lowerIsBetter: false },
};

export const BOARD_IDS = Object.keys(BOARDS) as readonly BoardId[];
export const BOARD_SIZE = 10;

export interface BoardEntry {
  readonly name: string;
  readonly value: number;
  /** ISO date of the result. */
  readonly at: string;
  /** Extra words, such as the rest of a rift party. */
  readonly detail?: string;
}

/** As stored on the server: `key` identifies the hero, so each hero holds one place at most. */
export interface StoredEntry extends BoardEntry {
  readonly key: string;
}

export interface Board {
  readonly id: BoardId;
  readonly entries: readonly BoardEntry[];
}

/**
 * Adds a result to a board, keeping each hero's best only and the top BOARD_SIZE overall.
 * Returns the new entries and the result's place (1-based), or null if it did not place.
 */
export function placeOnBoard(board: BoardId, entries: readonly StoredEntry[], entry: StoredEntry): { entries: StoredEntry[]; place: number | null } {
  const lower = BOARDS[board].lowerIsBetter;
  const better = (a: number, b: number): boolean => (lower ? a < b : a > b);
  const existing = entries.find((e) => e.key === entry.key);
  if (existing && !better(entry.value, existing.value)) return { entries: [...entries], place: null };
  const next = [...entries.filter((e) => e.key !== entry.key), entry]
    .sort((a, b) => (lower ? a.value - b.value : b.value - a.value) || a.at.localeCompare(b.at))
    .slice(0, BOARD_SIZE);
  const index = next.indexOf(entry);
  return { entries: next, place: index >= 0 ? index + 1 : null };
}

/** "1:05.3" for times, "4,250" for points and ratings. */
export function formatBoardValue(board: BoardId, value: number): string {
  if (BOARDS[board].unit !== 'time') return Math.round(value).toLocaleString('en-US');
  return formatRaceTime(value);
}

/** Seconds as m:ss.t */
export function formatRaceTime(seconds: number): string {
  const tenths = Math.max(0, Math.floor(seconds * 10));
  const m = Math.floor(tenths / 600);
  const s = Math.floor((tenths % 600) / 10);
  return `${m}:${String(s).padStart(2, '0')}.${tenths % 10}`;
}
