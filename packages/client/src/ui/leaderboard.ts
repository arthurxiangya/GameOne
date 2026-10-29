import { BOARDS, formatBoardValue, type Board } from '@lanternwood/shared';
import { byId, el } from './dom';

/** The leaderboards (L). Boards are fetched from the server each time the panel opens. */
export class LeaderboardView {
  private readonly root = byId('boards');
  private readonly body = byId('bBody');

  constructor() {
    byId('bClose').addEventListener('click', () => this.close());
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  close(): void {
    this.root.hidden = true;
  }

  /** Opens with a loading line until `show` arrives. */
  open(): void {
    this.root.hidden = false;
    this.body.replaceChildren(el('p', 'dim', 'Fetching the boards…'));
  }

  show(boards: readonly Board[], you: string): void {
    if (!this.isOpen) return;
    const sections = boards.map((board) => {
      const def = BOARDS[board.id];
      const section = el('section', 'j-sec');
      section.append(el('h3', undefined, def.title));
      if (board.entries.length === 0) {
        section.append(el('p', 'dim', board.id === 'race' ? 'No runs yet. Talk to Pip the Runner in Emberhold.' : 'Nothing yet.'));
        return section;
      }
      const list = el('ol', 'board');
      for (const entry of board.entries) {
        const item = el('li', entry.name === you ? 'you' : undefined);
        item.append(el('span', 'who', entry.detail ? `${entry.name} · ${entry.detail}` : entry.name), el('b', undefined, formatBoardValue(board.id, entry.value)));
        list.append(item);
      }
      section.append(list);
      return section;
    });
    this.body.replaceChildren(...sections);
  }
}
