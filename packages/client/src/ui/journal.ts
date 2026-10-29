import {
  CHAINS,
  TITLES,
  bountyGold,
  chainStatus,
  currentStep,
  formatRaceTime,
  npcName,
  objectiveText,
  type ChainId,
  type PlayerProgress,
  type TitleId,
} from '@lanternwood/shared';
import { bountyLines, untilNewBounties } from '../app/conversations';
import { byId, el } from './dom';

export interface JournalHandlers {
  /** Show this chain in the tracker and on the map. */
  track(id: ChainId): void;
  /** Show this title under your name, or none. */
  title(id: TitleId | null): void;
}

/** The journal (J): every story, today's bounties, Ember Marks and titles. */
export class JournalView {
  private readonly root = byId('journal');
  private readonly body = byId('jBody');

  constructor(private readonly handlers: JournalHandlers) {
    byId('jClose').addEventListener('click', () => this.close());
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  close(): void {
    this.root.hidden = true;
  }

  open(p: PlayerProgress, tracked: ChainId | null, nowMs: number): void {
    this.root.hidden = false;
    this.render(p, tracked, nowMs);
  }

  /** Re-renders if open, for example when progress arrives. */
  refresh(p: PlayerProgress, tracked: ChainId | null, nowMs: number): void {
    if (this.isOpen) this.render(p, tracked, nowMs);
  }

  private render(p: PlayerProgress, tracked: ChainId | null, nowMs: number): void {
    const stories = el('section', 'j-sec');
    stories.append(el('h3', undefined, 'Stories'));
    for (const chain of CHAINS) {
      const cp = p.story[chain.id];
      const status = chainStatus(chain, cp, p.level);
      const step = currentStep(chain, cp);
      let line: string;
      if (status === 'done') line = 'Complete';
      else if (status === 'locked') line = `From level ${chain.minLevel} · ${npcName(chain.giver)}`;
      else if (status === 'available') line = `New · talk to ${npcName(chain.giver)}`;
      else if (status === 'ready' && step?.turnIn) line = `${step.title} · return to ${npcName(step.turnIn)}`;
      else line = step ? `${step.title} · ${objectiveText(step.objective, cp.progress)}` : '';
      const row = el('button', `j-row${chain.id === tracked ? ' on' : ''}${status === 'done' || status === 'locked' ? ' quiet' : ''}`);
      row.type = 'button';
      row.disabled = status === 'done' || status === 'locked';
      row.append(el('b', undefined, chain.title), el('span', undefined, line));
      if (chain.id === tracked) row.append(el('em', undefined, 'Tracking'));
      row.addEventListener('click', () => {
        this.handlers.track(chain.id);
        this.render(p, chain.id, nowMs);
      });
      stories.append(row);
    }

    const bounties = el('section', 'j-sec');
    bounties.append(el('h3', undefined, 'Today’s bounties'));
    const lines = bountyLines(p);
    if (lines.length === 0) bounties.append(el('p', 'dim', 'Captain Rook posts bounties at midnight UTC.'));
    for (const l of lines) {
      const row = el('div', `j-row static${l.done ? ' quiet' : ''}`);
      row.append(el('b', undefined, `${l.done ? '✓ ' : ''}${l.title}`), el('span', undefined, l.text), el('em', undefined, l.status));
      bounties.append(row);
    }
    bounties.append(el('p', 'dim', `Each pays ${bountyGold(p.level)} gold, XP and an Ember Mark. New bounties in ${untilNewBounties(nowMs)}.`));

    const you = el('section', 'j-sec');
    const r = p.records;
    const records = [
      r.raceBest !== null ? `Ember Run best ${formatRaceTime(r.raceBest)}` : '',
      r.riftBest > 0 ? `Rift best ${r.riftBest.toLocaleString('en-US')}` : '',
      r.nightsWon > 0 ? `Lantern Nights won ${r.nightsWon}` : '',
      r.duelWins + r.duelLosses + r.duelDraws > 0 ? `Duels ${r.duelWins}–${r.duelLosses}–${r.duelDraws}, rating ${r.rating}` : '',
    ].filter(Boolean);
    you.append(el('h3', undefined, `Ember Marks: ${p.marks}`));
    if (records.length) you.append(el('p', 'dim', records.join(' · ')));
    you.append(el('p', 'dim', p.titles.length ? 'Choose the title shown under your name:' : 'Finish stories to earn titles. Smith Oda trades Ember Marks.'));
    if (p.titles.length) {
      const chips = el('div', 'chips');
      const chip = (label: string, id: TitleId | null): void => {
        const b = el('button', `chip${p.title === id ? ' on' : ''}`, label);
        b.type = 'button';
        b.setAttribute('aria-pressed', String(p.title === id));
        b.addEventListener('click', () => this.handlers.title(id));
        chips.append(b);
      };
      chip('None', null);
      for (const id of p.titles) chip(TITLES[id].name, id);
      you.append(chips);
    }
    this.body.replaceChildren(stories, bounties, you);
  }
}
