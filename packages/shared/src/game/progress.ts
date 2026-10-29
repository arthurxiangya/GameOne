import { emptyBountyProgress, type BountyProgress } from './bounties';
import { STARTING_TONICS } from './economy';
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
}

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
});

/** A deep copy, for sending: the server keeps mutating its own. */
export const cloneProgress = (p: PlayerProgress): PlayerProgress => ({
  ...p,
  story: Object.fromEntries(Object.entries(p.story).map(([k, v]) => [k, { ...v }])) as StoryProgress,
  bounties: { day: p.bounties.day, ids: [...p.bounties.ids], counts: [...p.bounties.counts], done: [...p.bounties.done], seen: [...p.bounties.seen] },
  titles: [...p.titles],
});
