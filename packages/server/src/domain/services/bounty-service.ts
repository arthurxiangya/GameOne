import {
  ALL_BOUNTIES_MARKS,
  BOUNTY_MARKS,
  bountyCount,
  bountyFromId,
  bountyGold,
  bountyXp,
  killCounts,
  type BountyDef,
} from '@lanternwood/shared';
import type { Achievement } from '../achievements';
import type { Player } from '../entities/player';
import type { EventSink } from '../events';
import type { ProgressionService } from './progression-service';

/** Today's bounty ids for a day. Injected so the board can depend on the realm and its modes. */
export type BountyBoard = (day: number) => readonly string[];

/** Daily bounties: posting the day's board to each hero, counting progress and paying rewards. */
export class BountyService {
  constructor(
    private readonly events: EventSink,
    private readonly progression: ProgressionService,
    private readonly board: BountyBoard,
  ) {}

  /** Moves a hero onto `day`'s board, clearing yesterday's progress. Returns true if anything changed. */
  refresh(player: Player, day: number): boolean {
    const b = player.progress.bounties;
    const ids = this.board(day);
    if (b.day === day && b.ids.length === ids.length && b.ids.every((id, i) => id === ids[i])) return false;
    b.day = day;
    b.ids = [...ids];
    b.counts = ids.map(() => 0);
    b.done = ids.map(() => false);
    b.seen = [];
    player.touchProgress();
    return true;
  }

  onAchievement(player: Player, a: Achievement, day: number): void {
    this.refresh(player, day);
    const b = player.progress.bounties;
    const defs = b.ids.map(bountyFromId);
    const before = defs.map((def, i) => (def ? bountyCount(def, b.counts[i] ?? 0, b.seen) : 0));
    if (a.kind === 'kill') {
      defs.forEach((def, i) => {
        if (!def || b.done[i] || !killCounts(def.kind, a.level, player.level)) return;
        b.counts[i] = (b.counts[i] ?? 0) + 1;
        player.touchProgress();
      });
    } else {
      const mark = a.kind === 'visit' ? `place:${a.place}` : `npc:${a.npc}`;
      if (b.seen.includes(mark)) return;
      b.seen.push(mark);
      player.touchProgress();
    }
    defs.forEach((def, i) => {
      if (!def || b.done[i]) return;
      const count = bountyCount(def, b.counts[i] ?? 0, b.seen);
      if (count === before[i]) return;
      if (count >= def.need) this.complete(player, def, i);
      else this.events.player(player.id, { e: 'toast', text: `Bounty · ${def.title} ${count} / ${def.need}` });
    });
  }

  private complete(player: Player, def: BountyDef, index: number): void {
    const b = player.progress.bounties;
    b.done[index] = true;
    const gold = bountyGold(player.level);
    this.progression.grantGold(player, gold);
    this.progression.grantMarks(player, BOUNTY_MARKS);
    this.events.player(player.id, { e: 'log', text: `Bounty complete: ${def.title} · +${gold} gold · +${BOUNTY_MARKS} Ember Mark`, c: 'sys' });
    this.events.player(player.id, { e: 'toast', text: `Bounty complete: ${def.title}` });
    this.progression.grantXp(player, bountyXp(player.level));
    if (b.done.every(Boolean)) {
      this.progression.grantMarks(player, ALL_BOUNTIES_MARKS);
      this.events.player(player.id, { e: 'log', text: `Every bounty done today · +${ALL_BOUNTIES_MARKS} Ember Marks`, c: 'good' });
    }
    player.touchProgress();
  }
}
