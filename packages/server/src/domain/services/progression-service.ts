import { MAX_LEVEL, SKILLS, SKILL_IDS, TITLES, xpToNext, type TitleId } from '@lanternwood/shared';
import type { Player } from '../entities/player';
import type { EventSink } from '../events';

/** Experience, levels, gold, Ember Marks and titles. */
export class ProgressionService {
  constructor(private readonly events: EventSink) {}

  grantXp(player: Player, amount: number): void {
    if (amount <= 0) return;
    const p = player.progress;
    if (p.level >= MAX_LEVEL) return;
    p.xp += Math.round(amount);
    this.events.player(player.id, { e: 'xp', amt: Math.round(amount) });
    while (p.level < MAX_LEVEL && p.xp >= xpToNext(p.level)) {
      p.xp -= xpToNext(p.level);
      p.level += 1;
      player.restoreVitals();
      this.events.area(player.body.x, player.body.z, { e: 'lvl', id: player.id, lv: p.level });
      this.events.player(player.id, { e: 'log', text: `You reached level ${p.level}!`, c: 'sys' });
      for (const id of SKILL_IDS) {
        const skill = SKILLS[id];
        if (skill.unlockLevel === p.level) this.events.player(player.id, { e: 'toast', text: `New skill: ${skill.name}` });
      }
    }
    if (p.level >= MAX_LEVEL) p.xp = 0;
    player.touchProgress();
  }

  grantGold(player: Player, amount: number): void {
    if (amount <= 0) return;
    player.progress.gold += Math.round(amount);
    player.touchProgress();
  }

  grantMarks(player: Player, amount: number): void {
    if (amount <= 0) return;
    player.progress.marks += Math.round(amount);
    player.touchProgress();
  }

  /** Adds a title; the first title a hero earns is shown straight away. */
  grantTitle(player: Player, title: TitleId): void {
    const p = player.progress;
    if (p.titles.includes(title)) return;
    p.titles.push(title);
    if (p.title === null) p.title = title;
    player.touchProgress();
    this.events.player(player.id, { e: 'toast', text: `New title: ${TITLES[title].name}` });
    this.events.player(player.id, { e: 'log', text: `You earned the title ${TITLES[title].name}. Choose your title in the journal (J).`, c: 'good' });
  }
}
