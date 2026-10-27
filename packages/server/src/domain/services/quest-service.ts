import { ITEM_DROP_CHANCE, QUESTS, questAt, type MonsterType, type RandomSource } from '@lanternwood/shared';
import type { Player } from '../entities/player';
import type { EventSink } from '../events';
import { fail, ok, type Result } from '../result';
import type { ProgressionService } from './progression-service';

/** The linear quest chain given out by Elder Maren. */
export class QuestService {
  constructor(
    private readonly events: EventSink,
    private readonly progression: ProgressionService,
    private readonly rng: RandomSource,
  ) {}

  accept(player: Player): Result {
    const p = player.progress;
    const quest = questAt(p.quest);
    if (!quest || p.questState === 'done') return fail('There are no quests left. The realm is at peace.');
    if (p.questState !== 'available') return fail('Finish your current quest first.');
    p.questState = 'active';
    p.questProgress = 0;
    player.touchProgress();
    this.events.player(player.id, { e: 'log', text: `Quest accepted: ${quest.title}`, c: 'sys' });
    this.events.player(player.id, { e: 'toast', text: `${quest.title}: ${quest.label} 0 / ${quest.need}` });
    return ok();
  }

  turnIn(player: Player): Result {
    const p = player.progress;
    const quest = questAt(p.quest);
    if (!quest || p.questState !== 'ready') return fail('That quest is not finished yet.');
    this.progression.grantGold(player, quest.gold);
    p.tonics += quest.tonics;
    this.events.player(player.id, { e: 'log', text: `Quest complete: ${quest.title} · +${quest.gold} gold`, c: 'sys' });
    this.progression.grantXp(player, quest.xp);
    p.quest += 1;
    p.questProgress = 0;
    p.questState = p.quest >= QUESTS.length ? 'done' : 'available';
    this.events.player(player.id, {
      e: 'toast',
      text: p.questState === 'done' ? 'You are a hero of the realm!' : 'Elder Maren has another task for you.',
    });
    player.touchProgress();
    return ok();
  }

  onMonsterKilled(player: Player, type: MonsterType): void {
    const p = player.progress;
    const quest = questAt(p.quest);
    if (!quest || p.questState !== 'active' || quest.target !== type) return;
    if (quest.item) {
      if (this.rng.next() >= ITEM_DROP_CHANCE) return;
      this.events.player(player.id, { e: 'log', text: `Looted: ${quest.item}`, c: 'loot' });
    }
    p.questProgress = Math.min(quest.need, p.questProgress + 1);
    if (p.questProgress >= quest.need) {
      p.questState = 'ready';
      this.events.player(player.id, { e: 'toast', text: 'Quest complete! Return to Elder Maren in Emberhold.' });
      this.events.player(player.id, { e: 'log', text: `Objective complete: ${quest.title}`, c: 'sys' });
    } else {
      this.events.player(player.id, { e: 'toast', text: `${quest.label} ${p.questProgress} / ${quest.need}` });
    }
    player.touchProgress();
  }
}
