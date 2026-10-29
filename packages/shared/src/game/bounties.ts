import { Mulberry32, type RandomSource } from '../math/random';
import { LANDMARK_IDS, LANDMARK_NAMES, isLandmarkId, type LandmarkId } from '../world/landmarks';
import { npcName, type NpcId } from './npcs';
import { MAX_LEVEL, xpToNext } from './stats';

/**
 * Daily bounties. Every day (UTC) three are posted, one from each slot, picked from the world
 * seed and the day number: every server process and the single-player preview agree on the
 * board without storing it. A bounty is fully described by its id, so saves and the client
 * only ever carry ids.
 */

export type BountyKind = 'hunt' | 'bigGame' | 'scout' | 'courier' | 'run' | 'defend' | 'delve' | 'spar';
export type BountySlot = 'fight' | 'explore' | 'mode';

export interface BountyDef {
  readonly id: string;
  readonly kind: BountyKind;
  readonly slot: BountySlot;
  readonly title: string;
  readonly text: string;
  readonly need: number;
  readonly places: readonly LandmarkId[];
  readonly npcs: readonly NpcId[];
}

export const BOUNTIES_PER_DAY = 3;
export const DAY_MS = 86_400_000;

/** Days since 1970-01-01 UTC. */
export const dayNumber = (epochMs: number): number => Math.floor(epochMs / DAY_MS);

const HUNT_LEVEL_GAP = 3;
const COURIER_NPCS: readonly NpcId[] = ['tamsin', 'bryn', 'sefa'];

const list = (names: readonly string[]): string =>
  names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;

/** Rebuilds a bounty from its id, or null for an id this build does not know. */
export function bountyFromId(id: string): BountyDef | null {
  const base = { places: [] as LandmarkId[], npcs: [] as NpcId[] };
  if (id === 'hunt') {
    return { ...base, id, kind: 'hunt', slot: 'fight', title: 'Hunt', need: 10, text: `Defeat 10 monsters no more than ${HUNT_LEVEL_GAP} levels below you` };
  }
  if (id === 'bigGame') {
    return { ...base, id, kind: 'bigGame', slot: 'fight', title: 'Big game', need: 3, text: 'Defeat 3 monsters above your level' };
  }
  if (id === 'defend') {
    return { ...base, id, kind: 'defend', slot: 'mode', title: 'Defend', need: 1, text: 'Take part in a Lantern Night (the Night Bell rings at dusk, every third night)' };
  }
  if (id === 'spar') {
    return { ...base, id, kind: 'spar', slot: 'mode', title: 'Spar', need: 1, text: 'Fight a duel, win or lose (select a hero, then Duel)' };
  }
  if (id === 'delve') {
    return { ...base, id, kind: 'delve', slot: 'mode', title: 'Delve', need: 1, text: 'Reach wave 3 in a Rift Trial (Seer Ilka, level 6 and up)' };
  }
  if (id === 'run') {
    return { ...base, id, kind: 'run', slot: 'explore', title: 'Run', need: 1, text: 'Finish an Ember Run (Pip the Runner, Emberhold)' };
  }
  if (id === 'courier') {
    return { ...base, id, kind: 'courier', slot: 'explore', title: 'Courier', need: COURIER_NPCS.length, npcs: COURIER_NPCS, text: `Talk to ${list(COURIER_NPCS.map(npcName))}` };
  }
  if (id.startsWith('scout:')) {
    const places = id.slice(6).split('+');
    if (places.length !== 2 || !places.every(isLandmarkId) || places[0] === places[1]) return null;
    const ids = places as LandmarkId[];
    return { ...base, id, kind: 'scout', slot: 'explore', title: 'Scout', need: 2, places: ids, text: `Visit ${list(ids.map((p) => LANDMARK_NAMES[p]))}` };
  }
  return null;
}

export interface BountyBoardOptions {
  /** Whether duels exist here (online only): the Spar bounty needs a second hero. */
  readonly duels: boolean;
}

const pick = <T>(rng: RandomSource, items: readonly T[]): T => items[Math.floor(rng.next() * items.length)]!;

function scoutId(rng: RandomSource): string {
  const first = pick(rng, LANDMARK_IDS);
  const second = pick(rng, LANDMARK_IDS.filter((l) => l !== first));
  return `scout:${first}+${second}`;
}

/** The ids of the three bounties posted on `day`, in slot order: fight, explore, mode. */
export function bountiesForDay(seed: number, day: number, options: BountyBoardOptions): readonly string[] {
  const rng = new Mulberry32((Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul(day | 0, 0x85ebca6b)) | 0);
  // Warm up: nearby seeds give nearby first draws.
  for (let i = 0; i < 4; i++) rng.next();
  const fight = pick(rng, ['hunt', 'bigGame']);
  const exploreKinds = ['scout', 'courier', 'run'] as const;
  const exploreKind = pick(rng, exploreKinds);
  const explore = exploreKind === 'scout' ? scoutId(rng) : exploreKind;
  const mode = pick(rng, options.duels ? ['defend', 'delve', 'spar'] : ['defend', 'delve']);
  return [fight, explore, mode];
}

// ---------------------------------------------------------------- progress

export interface BountyProgress {
  /** The day these bounties belong to; progress from another day is cleared. */
  day: number;
  ids: string[];
  counts: number[];
  done: boolean[];
  /** Places visited and characters talked to today. */
  seen: string[];
}

export const emptyBountyProgress = (): BountyProgress => ({ day: -1, ids: [], counts: [], done: [], seen: [] });

/** Does a kill of a monster at `monsterLevel` count for a fight bounty for a hero at `heroLevel`? */
export function killCounts(kind: BountyKind, monsterLevel: number, heroLevel: number): boolean {
  if (kind === 'hunt') return monsterLevel >= heroLevel - HUNT_LEVEL_GAP;
  if (kind === 'bigGame') return monsterLevel > heroLevel;
  return false;
}

/** Does finishing an Ember Run count for this bounty? */
export const runCounts = (kind: BountyKind): boolean => kind === 'run';
/** Does taking part in a Lantern Night count for this bounty? */
export const siegeCounts = (kind: BountyKind): boolean => kind === 'defend';
/** Does fighting a duel count for this bounty? */
export const duelCounts = (kind: BountyKind): boolean => kind === 'spar';
/** Does reaching `wave` of a Rift Trial count for this bounty? */
export const riftCounts = (kind: BountyKind, wave: number): boolean => kind === 'delve' && wave >= 3;

/** How far along a bounty is, from the counters and the places and people seen today. */
export function bountyCount(def: BountyDef, count: number, seen: readonly string[]): number {
  if (def.kind === 'scout') return def.places.filter((p) => seen.includes(`place:${p}`)).length;
  if (def.kind === 'courier') return def.npcs.filter((n) => seen.includes(`npc:${n}`)).length;
  return Math.min(count, def.need);
}

export const bountyGold = (level: number): number => 30 + 8 * level;
export const bountyXp = (level: number): number => (level >= MAX_LEVEL ? 0 : Math.round(xpToNext(level) * 0.2));
export const BOUNTY_MARKS = 1;
/** Extra Marks for finishing all three in a day. */
export const ALL_BOUNTIES_MARKS = 2;
