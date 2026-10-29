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

export type BountyKind = 'hunt' | 'bigGame' | 'scout' | 'courier';
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
  /** Whether duels exist here (online only). Reserved for the Spar bounty. */
  readonly duels: boolean;
}

const pick = <T>(rng: RandomSource, items: readonly T[]): T => items[Math.floor(rng.next() * items.length)]!;

function scoutId(rng: RandomSource): string {
  const first = pick(rng, LANDMARK_IDS);
  const second = pick(rng, LANDMARK_IDS.filter((l) => l !== first));
  return `scout:${first}+${second}`;
}

/** The ids of the three bounties posted on `day`, in slot order: fight, explore, mode. */
export function bountiesForDay(seed: number, day: number, _options: BountyBoardOptions): readonly string[] {
  const rng = new Mulberry32((Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul(day | 0, 0x85ebca6b)) | 0);
  // Warm up: nearby seeds give nearby first draws.
  for (let i = 0; i < 4; i++) rng.next();
  const fight = pick(rng, ['hunt', 'bigGame']);
  const explore = rng.next() < 0.5 ? scoutId(rng) : 'courier';
  // No mode has a bounty yet; until one does, the third slot repeats a kind not already posted.
  const spare = [fight === 'hunt' ? 'bigGame' : 'hunt', explore === 'courier' ? scoutId(rng) : 'courier'];
  return [fight, explore, pick(rng, spare)];
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
