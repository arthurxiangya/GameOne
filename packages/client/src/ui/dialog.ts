import type { NpcDef } from '@lanternwood/shared';
import type { Paragraph, Topic, TopicAction } from '../app/conversations';
import { byId, el } from './dom';

interface Button {
  readonly label: string;
  readonly primary?: boolean;
  readonly disabled?: boolean;
  readonly run: () => void;
}

/**
 * Modal conversation with a character. A character with one thing to say opens straight into
 * it; one with several shows them as a list first. Content comes from `npcTopics`.
 */
export class DialogView {
  private readonly root = byId('dialog');
  private readonly title = byId('dlgTitle');
  private readonly who = byId('dlgWho');
  private readonly body = byId('dlgBody');
  private readonly actions = byId('dlgActs');
  private current: NpcDef | null = null;
  private topicKey: string | null = null;

  get npc(): NpcDef | null {
    return this.current;
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  close(): void {
    this.root.hidden = true;
    this.current = null;
    this.topicKey = null;
  }

  /**
   * Shows `npc`'s topics. With `refresh`, stays on the topic already open (after a purchase,
   * say) as long as it still exists. `choose` sends a topic action to the server.
   */
  show(npc: NpcDef, topics: readonly Topic[], choose: (action: TopicAction) => void, refresh = false): void {
    const sameNpc = this.current?.id === npc.id;
    this.current = npc;
    const open = refresh && sameNpc ? topics.find((t) => t.key === this.topicKey) : undefined;
    if (refresh && sameNpc && this.topicKey === null) return this.showMenu(npc, topics, choose);
    if (open) return this.showTopic(npc, open, topics, choose);
    if (topics.length === 1) return this.showTopic(npc, topics[0]!, topics, choose);
    this.showMenu(npc, topics, choose);
  }

  private showMenu(npc: NpcDef, topics: readonly Topic[], choose: (action: TopicAction) => void): void {
    this.topicKey = null;
    this.render(npc.name, npc.role, [npc.idle], [
      ...topics.map((t) => ({
        label: `${t.mark ? `${t.mark}  ` : ''}${t.label}`,
        primary: t.mark !== '',
        run: () => this.showTopic(npc, t, topics, choose),
      })),
      { label: 'Farewell', run: () => this.close() },
    ]);
  }

  private showTopic(npc: NpcDef, topic: Topic, topics: readonly Topic[], choose: (action: TopicAction) => void): void {
    this.topicKey = topic.key;
    const buttons: Button[] = topic.actions.map((a) => ({
      label: a.label,
      primary: a.primary,
      disabled: a.disabled,
      run: () => {
        if (a.send) choose(a);
        if (a.close !== false) this.close();
      },
    }));
    if (topics.length > 1) buttons.push({ label: 'Back', run: () => this.showMenu(npc, topics, choose) });
    this.render(topic.title, npc.name, topic.paragraphs, buttons);
  }

  private render(title: string, who: string, paragraphs: readonly Paragraph[], buttons: readonly Button[]): void {
    this.title.textContent = title;
    this.who.textContent = who;
    this.body.replaceChildren(...paragraphs.map((p) => (typeof p === 'string' ? el('p', undefined, p) : el('p', 'dim', p.dim))));
    this.actions.replaceChildren(
      ...buttons.map((b) => {
        const button = el('button', `btn ${b.primary ? 'primary' : 'ghost'}`, b.label);
        button.type = 'button';
        button.disabled = b.disabled ?? false;
        button.addEventListener('click', () => {
          button.blur();
          b.run();
        });
        return button;
      }),
    );
    this.root.hidden = false;
  }
}
