import type { LandmarkId, MonsterType, NpcId } from '@lanternwood/shared';
import type { Player } from './entities/player';

/**
 * Something a hero did that stories and bounties may care about. Combat, movement and
 * conversations report these; they never call the story or bounty services directly, so a new
 * kind of objective is a new achievement, not a change to combat.
 */
export type Achievement =
  | { readonly kind: 'kill'; readonly monster: MonsterType; readonly level: number }
  | { readonly kind: 'visit'; readonly place: LandmarkId }
  | { readonly kind: 'greet'; readonly npc: NpcId };

export interface AchievementSink {
  record(player: Player, achievement: Achievement): void;
}
