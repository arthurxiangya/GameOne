import type { Achievement, AchievementSink } from '../achievements';
import type { Player } from '../entities/player';
import type { Calendar } from '../ports';
import type { BountyService } from './bounty-service';
import type { StoryService } from './story-service';

/** Hands every achievement to the services that count them: the story and today's bounties. */
export class ProgressTracker implements AchievementSink {
  constructor(
    private readonly story: StoryService,
    private readonly bounties: BountyService,
    private readonly calendar: Calendar,
  ) {}

  record(player: Player, achievement: Achievement): void {
    this.story.onAchievement(player, achievement);
    this.bounties.onAchievement(player, achievement, this.calendar.today());
  }
}
