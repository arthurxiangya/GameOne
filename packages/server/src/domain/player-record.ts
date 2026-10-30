import {
  BAG_SIZE,
  CHAINS,
  CLASS_IDS,
  DEFAULT_CLASS,
  EGG_HATCH_KILLS,
  GEAR_SLOTS,
  ILVL_CEILING,
  LEGACY_ILVL_PER_TIER,
  LEGACY_MAX_WEAPON_TIER,
  LEGENDARIES,
  MAX_EGGS,
  MAX_LEVEL,
  PET_MAX_LEVEL,
  SET_IDS,
  affixCount,
  isAffixStat,
  isGearSlot,
  isLegendaryId,
  isRarity,
  STEP_STATES,
  cloneProgress,
  emptyBountyProgress,
  isClassId,
  isMountId,
  isPetId,
  newRecords,
  isTitleId,
  newChainProgress,
  newProgress,
  newStoryProgress,
  sanitizeName,
  specOf,
  talentOf,
  type BountyProgress,
  type ClassId,
  type ChainProgress,
  type EggState,
  type Equipped,
  type GearSlot,
  type Item,
  type HeroRecords,
  type MountId,
  type PetState,
  type SetId,
  type PlayerProgress,
  type SpecId,
  type TalentPicks,
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
    cls: r.cls,
    specs: r.specs,
    talents: r.talents,
    level: r.level,
    xp: r.xp,
    gold: r.gold,
    tonics: r.tonics,
    gear: r.gear,
    bag: r.bag,
    embers: r.embers,
    itemSeq: r.itemSeq,
    falls: r.falls,
    story: r.story,
    bounties: r.bounties,
    marks: r.marks,
    titles: r.titles,
    title: r.title,
    mounts: r.mounts,
    mount: r.mount,
    pets: r.pets,
    pet: r.pet,
    eggs: r.eggs,
    records: r.records,
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
  if (!intIn(r.falls, 0, 1e9)) return null;
  const titles = parseTitles(r.titles);
  const story = parseStory(r.story) ?? migrateLegacyQuest(r);
  const mounts = Array.isArray(r.mounts) ? [...new Set(r.mounts.filter(isMountId))] : [];
  grantMissingUnlocks(story, titles, mounts);
  const title = isTitleId(r.title) && titles.includes(r.title) ? r.title : null;
  const pets = parsePets(r.pets);
  const owns = (pet: unknown): boolean => pets.some((x) => x.id === pet);
  const items = parseItems(r);
  return {
    accountId: r.accountId,
    name,
    // Heroes from before classes become Emberblades until they pick on the title screen.
    cls: isClassId(r.cls) ? r.cls : DEFAULT_CLASS,
    specs: parseSpecs(r.specs),
    talents: parseTalents(r.talents),
    level: r.level,
    xp: r.xp,
    gold: r.gold,
    tonics: r.tonics,
    ...items,
    falls: r.falls,
    story,
    bounties: parseBounties(r.bounties) ?? emptyBountyProgress(),
    marks: intIn(r.marks, 0, 1e6) ? r.marks : 0,
    titles,
    title,
    mounts,
    mount: isMountId(r.mount) && mounts.includes(r.mount) ? r.mount : (mounts[0] ?? null),
    pets,
    pet: isPetId(r.pet) && owns(r.pet) ? r.pet : null,
    eggs: parseEggs(r.eggs).filter((e) => !owns(e.pet)),
    records: parseRecords(r.records),
    createdAt: typeof r.createdAt === 'string' ? r.createdAt : new Date(0).toISOString(),
    updatedAt: typeof r.updatedAt === 'string' ? r.updatedAt : new Date(0).toISOString(),
  };
}

/** One stored item, or null if anything about it is off. */
function parseItem(v: unknown): Item | null {
  if (!isRecord(v) || !intIn(v.id, 1, 1e9) || !isGearSlot(v.slot) || !isRarity(v.rarity)) return null;
  if (!intIn(v.ilvl, 1, ILVL_CEILING) || !intIn(v.tier, 0, 2)) return null;
  const set = SET_IDS.includes(v.set as SetId) ? (v.set as SetId) : null;
  const legendary = isLegendaryId(v.legendary) ? v.legendary : null;
  if (legendary && (v.rarity !== 'legendary' || LEGENDARIES[legendary].slot !== v.slot)) return null;
  if (!Array.isArray(v.affixes) || !v.affixes.every(isAffixStat) || v.affixes.length !== affixCount(v.slot, v.rarity, set)) return null;
  const reforged = intIn(v.reforged, -1, v.affixes.length - 1) ? v.reforged : -1;
  return { id: v.id, slot: v.slot, rarity: v.rarity, ilvl: v.ilvl, tier: v.tier as 0 | 1 | 2, affixes: [...v.affixes], reforged, set, legendary };
}

/**
 * Gear, bag, Embers and the item counter. Item ids must be unique and below the counter, and
 * at most one legendary may be worn. Saves from before gear had a weapon tier (0–5): it becomes
 * a weapon of item level 20 × tier, which gives the same Power, so nobody gets weaker.
 */
function parseItems(r: Record<string, unknown>): { gear: Equipped; bag: Item[]; embers: number; itemSeq: number } {
  const seen = new Set<number>();
  const fresh = (item: Item | null): item is Item => item !== null && !seen.has(item.id) && (seen.add(item.id), true);
  const gear: Partial<Record<GearSlot, Item>> = {};
  if (isRecord(r.gear)) {
    for (const slot of GEAR_SLOTS) {
      const item = parseItem(r.gear[slot]);
      if (!fresh(item) || item.slot !== slot) continue;
      if (item.legendary && Object.values(gear).some((g) => g?.legendary)) continue;
      gear[slot] = item;
    }
  }
  const bag = Array.isArray(r.bag) ? r.bag.map(parseItem).filter(fresh).slice(0, BAG_SIZE) : [];
  let itemSeq = Math.max(intIn(r.itemSeq, 1, 1e9) ? r.itemSeq : 1, ...[...seen].map((id) => id + 1));
  if (!('gear' in r) && intIn(r.weapon, 1, LEGACY_MAX_WEAPON_TIER)) {
    gear.weapon = { id: itemSeq++, slot: 'weapon', rarity: 'common', ilvl: r.weapon * LEGACY_ILVL_PER_TIER, tier: 0, affixes: [], reforged: -1, set: null, legendary: null };
  }
  return { gear, bag, embers: intIn(r.embers, 0, 1e9) ? r.embers : 0, itemSeq };
}

/**
 * Rewards that unlock something (titles, mounts) are granted again on load if the hero
 * finished their step before the reward existed, so new unlocks reach existing heroes.
 */
function grantMissingUnlocks(story: StoryProgress, titles: TitleId[], mounts: MountId[]): void {
  for (const chain of CHAINS) {
    chain.steps.slice(0, story[chain.id].step).forEach(({ reward }) => {
      if (reward.title && !titles.includes(reward.title)) titles.push(reward.title);
      if (reward.mount && !mounts.includes(reward.mount)) mounts.push(reward.mount);
    });
  }
}

function parseRecords(v: unknown): HeroRecords {
  const records = newRecords();
  if (!isRecord(v)) return records;
  if (typeof v.raceBest === 'number' && Number.isFinite(v.raceBest) && v.raceBest > 0) records.raceBest = v.raceBest;
  if (Number.isInteger(v.raceDay)) records.raceDay = v.raceDay as number;
  if (intIn(v.nightsWon, 0, 1e6)) records.nightsWon = v.nightsWon;
  if (intIn(v.riftBest, 0, 1e7)) records.riftBest = v.riftBest;
  if (Number.isInteger(v.riftLordDay)) records.riftLordDay = v.riftLordDay as number;
  for (const key of ['duelWins', 'duelLosses', 'duelDraws'] as const) if (intIn(v[key], 0, 1e7)) records[key] = v[key];
  if (intIn(v.rating, 0, 10_000)) records.rating = v.rating;
  return records;
}

function parsePets(v: unknown): PetState[] {
  if (!Array.isArray(v)) return [];
  const pets: PetState[] = [];
  for (const x of v) {
    if (!isRecord(x) || !isPetId(x.id) || pets.some((p) => p.id === x.id)) continue;
    const name = typeof x.name === 'string' ? sanitizeName(x.name) : null;
    pets.push({
      id: x.id,
      name: name ?? x.id,
      level: intIn(x.level, 1, PET_MAX_LEVEL) ? x.level : 1,
      xp: intIn(x.xp, 0, 1e7) ? x.xp : 0,
    });
  }
  return pets;
}

function parseEggs(v: unknown): EggState[] {
  if (!Array.isArray(v)) return [];
  const eggs: EggState[] = [];
  for (const x of v) {
    if (eggs.length >= MAX_EGGS || !isRecord(x) || !isPetId(x.pet) || eggs.some((e) => e.pet === x.pet)) continue;
    eggs.push({ pet: x.pet, kills: intIn(x.kills, 0, EGG_HATCH_KILLS) ? x.kills : 0 });
  }
  return eggs;
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
function migrateLegacyQuest(r: Record<string, unknown>): StoryProgress {
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

/** Keeps only specs that belong to their class. */
function parseSpecs(v: unknown): Partial<Record<ClassId, SpecId>> {
  const specs: Partial<Record<ClassId, SpecId>> = {};
  if (!isRecord(v)) return specs;
  for (const cls of CLASS_IDS) {
    const spec = specOf(cls, v[cls] as SpecId);
    if (spec) specs[cls] = spec.id;
  }
  return specs;
}

/** Keeps only talents that exist, in the row they belong to, for their own class. */
function parseTalents(v: unknown): Partial<Record<ClassId, TalentPicks>> {
  const talents: Partial<Record<ClassId, TalentPicks>> = {};
  if (!isRecord(v)) return talents;
  for (const cls of CLASS_IDS) {
    const raw = v[cls];
    if (!Array.isArray(raw)) continue;
    talents[cls] = [0, 1, 2, 3].map((row) => {
      const found = talentOf(cls, typeof raw[row] === 'string' ? (raw[row] as string) : null);
      return found && found.row === row ? found.talent.id : null;
    });
  }
  return talents;
}
