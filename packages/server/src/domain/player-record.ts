import {
  CHAINS,
  MAX_LEVEL,
  MAX_WEAPON_TIER,
  STEP_STATES,
  cloneProgress,
  emptyBountyProgress,
  isTitleId,
  newChainProgress,
  newProgress,
  newStoryProgress,
  sanitizeName,
  type BountyProgress,
  type ChainProgress,
  type PlayerProgress,
  type StepState,
  type StoryProgress,
  type TitleId,
} from '@lanternwood/shared';
import type { Player } from './entities/player';
import type { PlayerRecord } from './ports';

export const newPlayerRecord = (accountId: string, name: string, isoTime: string): PlayerRecord => ({
  ...newProgress(name),
  accountId,
  createdAt: isoTime,
  updatedAt: isoTime,
});

/** The live, mutable progress for a stored hero. A deep copy, so the record is never mutated through it. */
export const progressFromRecord = (r: PlayerRecord): PlayerProgress =>
  cloneProgress({
    name: r.name,
    level: r.level,
    xp: r.xp,
    gold: r.gold,
    tonics: r.tonics,
    weapon: r.weapon,
    falls: r.falls,
    story: r.story,
    bounties: r.bounties,
    marks: r.marks,
    titles: r.titles,
    title: r.title,
  });

export const recordFromPlayer = (base: PlayerRecord, player: Player, isoTime: string): PlayerRecord => ({
  ...base,
  ...progressFromRecord({ ...base, ...player.progress }),
  updatedAt: isoTime,
});

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const intIn = (v: unknown, min: number, max: number): v is number => Number.isInteger(v) && (v as number) >= min && (v as number) <= max;

/**
 * Validates a stored record; returns null if a core field is out of range. Fields added after
 * the first release are optional on disk and fall back to defaults, and saves from before the
 * story engine are migrated, so no hero is ever lost to an upgrade.
 */
export function parsePlayerRecord(data: unknown): PlayerRecord | null {
  if (!isRecord(data)) return null;
  const r = data;
  const name = typeof r.name === 'string' ? sanitizeName(r.name) : null;
  if (typeof r.accountId !== 'string' || !name) return null;
  if (!intIn(r.level, 1, MAX_LEVEL) || !intIn(r.xp, 0, 1e9) || !intIn(r.gold, 0, 1e9) || !intIn(r.tonics, 0, 9999)) return null;
  if (!intIn(r.weapon, 0, MAX_WEAPON_TIER) || !intIn(r.falls, 0, 1e9)) return null;
  const titles = parseTitles(r.titles);
  const story = parseStory(r.story) ?? migrateLegacyQuest(r, titles);
  const title = isTitleId(r.title) && titles.includes(r.title) ? r.title : null;
  return {
    accountId: r.accountId,
    name,
    level: r.level,
    xp: r.xp,
    gold: r.gold,
    tonics: r.tonics,
    weapon: r.weapon,
    falls: r.falls,
    story,
    bounties: parseBounties(r.bounties) ?? emptyBountyProgress(),
    marks: intIn(r.marks, 0, 1e6) ? r.marks : 0,
    titles,
    title,
    createdAt: typeof r.createdAt === 'string' ? r.createdAt : new Date(0).toISOString(),
    updatedAt: typeof r.updatedAt === 'string' ? r.updatedAt : new Date(0).toISOString(),
  };
}

function parseTitles(v: unknown): TitleId[] {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.filter(isTitleId))];
}

function parseChain(v: unknown, steps: number): ChainProgress | null {
  if (!isRecord(v) || !intIn(v.step, 0, steps) || !intIn(v.progress, 0, 1000)) return null;
  if (!STEP_STATES.includes(v.state as StepState)) return null;
  return { step: v.step, progress: v.progress, state: v.state as StepState };
}

/** Known chains are validated one by one; a chain this save has never seen starts fresh. */
function parseStory(v: unknown): StoryProgress | null {
  if (!isRecord(v)) return null;
  const story = newStoryProgress();
  for (const chain of CHAINS) story[chain.id] = parseChain(v[chain.id], chain.steps.length) ?? newChainProgress();
  return story;
}

/** Saves from before the story engine kept the main chain as `quest`, `questProgress`, `questState`. */
function migrateLegacyQuest(r: Record<string, unknown>, titles: TitleId[]): StoryProgress {
  const story = newStoryProgress();
  const steps = CHAINS[0]!.steps.length;
  if (!intIn(r.quest, 0, steps)) return story;
  const finished = r.quest >= steps || r.questState === 'done';
  const legacy = r.questState === 'active' || r.questState === 'ready' ? r.questState : 'available';
  story.main = {
    step: finished ? steps : r.quest,
    progress: intIn(r.questProgress, 0, 1000) ? r.questProgress : 0,
    state: finished ? 'active' : legacy,
  };
  // Heroes who beat the Warden before titles existed get the title they earned.
  if (finished && !titles.includes('hero')) titles.push('hero');
  return story;
}

function parseBounties(v: unknown): BountyProgress | null {
  if (!isRecord(v) || !Number.isInteger(v.day)) return null;
  const strings = (a: unknown, max: number): string[] | null =>
    Array.isArray(a) && a.length <= max && a.every((x) => typeof x === 'string' && x.length <= 80) ? (a as string[]) : null;
  const ids = strings(v.ids, 6);
  const seen = strings(v.seen, 40);
  const counts = Array.isArray(v.counts) && v.counts.every((c) => intIn(c, 0, 10_000)) ? (v.counts as number[]) : null;
  const done = Array.isArray(v.done) && v.done.every((d) => typeof d === 'boolean') ? (v.done as boolean[]) : null;
  if (!ids || !seen || !counts || !done || counts.length !== ids.length || done.length !== ids.length) return null;
  return { day: v.day as number, ids: [...ids], counts: [...counts], done: [...done], seen: [...seen] };
}
