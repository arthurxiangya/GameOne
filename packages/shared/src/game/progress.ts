import { STARTING_TONICS } from './economy';
import type { QuestState } from './quests';

/** Everything about a hero that persists between sessions. */
export interface PlayerProgress {
  name: string;
  level: number;
  xp: number;
  gold: number;
  tonics: number;
  weapon: number;
  quest: number;
  questProgress: number;
  questState: QuestState;
  falls: number;
}

export const newProgress = (name: string): PlayerProgress => ({
  name,
  level: 1,
  xp: 0,
  gold: 0,
  tonics: STARTING_TONICS,
  weapon: 0,
  quest: 0,
  questProgress: 0,
  questState: 'available',
  falls: 0,
});
