import {
  MAX_LEVEL,
  MAX_WEAPON_TIER,
  QUEST_STATES,
  QUESTS,
  newProgress,
  sanitizeName,
  type PlayerProgress,
  type QuestState,
} from '@lanternwood/shared';
import type { Player } from './entities/player';
import type { PlayerRecord } from './ports';

export const newPlayerRecord = (accountId: string, name: string, isoTime: string): PlayerRecord => ({
  ...newProgress(name),
  accountId,
  createdAt: isoTime,
  updatedAt: isoTime,
});

export const progressFromRecord = (r: PlayerRecord): PlayerProgress => ({
  name: r.name,
  level: r.level,
  xp: r.xp,
  gold: r.gold,
  tonics: r.tonics,
  weapon: r.weapon,
  quest: r.quest,
  questProgress: r.questProgress,
  questState: r.questState,
  falls: r.falls,
});

export const recordFromPlayer = (base: PlayerRecord, player: Player, isoTime: string): PlayerRecord => ({
  ...base,
  ...progressFromRecord({ ...base, ...player.progress }),
  updatedAt: isoTime,
});

const intIn = (v: unknown, min: number, max: number): v is number => Number.isInteger(v) && (v as number) >= min && (v as number) <= max;

/** Validates a stored record; returns null if anything is out of range. */
export function parsePlayerRecord(data: unknown): PlayerRecord | null {
  if (typeof data !== 'object' || data === null) return null;
  const r = data as Record<string, unknown>;
  const name = typeof r.name === 'string' ? sanitizeName(r.name) : null;
  if (typeof r.accountId !== 'string' || !name) return null;
  if (!intIn(r.level, 1, MAX_LEVEL) || !intIn(r.xp, 0, 1e9) || !intIn(r.gold, 0, 1e9) || !intIn(r.tonics, 0, 9999)) return null;
  if (!intIn(r.weapon, 0, MAX_WEAPON_TIER) || !intIn(r.quest, 0, QUESTS.length) || !intIn(r.questProgress, 0, 1000)) return null;
  if (!intIn(r.falls, 0, 1e9) || !QUEST_STATES.includes(r.questState as QuestState)) return null;
  return {
    accountId: r.accountId,
    name,
    level: r.level,
    xp: r.xp,
    gold: r.gold,
    tonics: r.tonics,
    weapon: r.weapon,
    quest: r.quest,
    questProgress: r.questProgress,
    questState: r.questState as QuestState,
    falls: r.falls,
    createdAt: typeof r.createdAt === 'string' ? r.createdAt : new Date(0).toISOString(),
    updatedAt: typeof r.updatedAt === 'string' ? r.updatedAt : new Date(0).toISOString(),
  };
}
