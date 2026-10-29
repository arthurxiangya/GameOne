import { emptyBountyProgress, type BountyProgress } from './bounties';
import { STARTING_TONICS } from './economy';
import type { MountId } from './mounts';
import type { EggState, PetId, PetState } from './pets';
import { newStoryProgress, type StoryProgress } from './story';
import type { TitleId } from './titles';

/** Everything about a hero that persists between sessions. */
export interface PlayerProgress {
  name: string;
  level: number;
  xp: number;
  gold: number;
  tonics: number;
  weapon: number;
  falls: number;
  story: StoryProgress;
  bounties: BountyProgress;
  /** Ember Marks, earned from bounties and modes. */
  marks: number;
  titles: TitleId[];
  /** The title shown under the hero's name, if any. */
  title: TitleId | null;
  mounts: MountId[];
  /** The mount R calls. */
  mount: MountId | null;
  pets: PetState[];
  /** The pet that follows the hero. */
  pet: PetId | null;
  eggs: EggState[];
  records: HeroRecords;
}

/** Personal bests and once-a-day reward markers for the game modes. */
export interface HeroRecords {
  /** Best Ember Run time in seconds. */
  raceBest: number | null;
  /** Day of the last Ember Run medal reward. */
  raceDay: number;
  /** Lantern Nights won. */
  nightsWon: number;
}

export const newRecords = (): HeroRecords => ({ raceBest: null, raceDay: -1, nightsWon: 0 });

export const newProgress = (name: string): PlayerProgress => ({
  name,
  level: 1,
  xp: 0,
  gold: 0,
  tonics: STARTING_TONICS,
  weapon: 0,
  falls: 0,
  story: newStoryProgress(),
  bounties: emptyBountyProgress(),
  marks: 0,
  titles: [],
  title: null,
  mounts: [],
  mount: null,
  pets: [],
  pet: null,
  eggs: [],
  records: newRecords(),
});

/** A deep copy, for sending: the server keeps mutating its own. */
export const cloneProgress = (p: PlayerProgress): PlayerProgress => ({
  ...p,
  story: Object.fromEntries(Object.entries(p.story).map(([k, v]) => [k, { ...v }])) as StoryProgress,
  bounties: { day: p.bounties.day, ids: [...p.bounties.ids], counts: [...p.bounties.counts], done: [...p.bounties.done], seen: [...p.bounties.seen] },
  titles: [...p.titles],
  mounts: [...p.mounts],
  pets: p.pets.map((x) => ({ ...x })),
  eggs: p.eggs.map((x) => ({ ...x })),
  records: { ...p.records },
});
