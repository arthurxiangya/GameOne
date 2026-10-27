import { MAX_WEAPON_TIER, TONIC_PRICE, questAt, sharpenCost, type NpcAction, type NpcDef, type PlayerProgress } from '@lanternwood/shared';
import { byId, el } from './dom';

export interface DialogAction {
  readonly label: string;
  readonly primary?: boolean;
  readonly disabled?: boolean;
  readonly run: () => void;
}

type Paragraph = string | { readonly dim: string };

/** Modal NPC dialog. Content comes from shared game data plus the hero's current progress. */
export class DialogView {
  private readonly root = byId('dialog');
  private readonly title = byId('dlgTitle');
  private readonly who = byId('dlgWho');
  private readonly body = byId('dlgBody');
  private readonly actions = byId('dlgActs');
  private current: NpcDef | null = null;

  get npc(): NpcDef | null {
    return this.current;
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  close(): void {
    this.root.hidden = true;
    this.current = null;
  }

  /** Shows the right conversation for `npc`; `act` sends an action to the server. */
  showFor(npc: NpcDef, progress: PlayerProgress, act: (action: NpcAction) => void): void {
    this.current = npc;
    if (npc.role === 'quests') this.showQuests(progress, act);
    else this.showShop(progress, act);
  }

  private showQuests(p: PlayerProgress, act: (action: NpcAction) => void): void {
    const quest = questAt(p.quest);
    if (!quest || p.questState === 'done') {
      this.render('Elder Maren', 'Emberhold', [`The Frost Heart is quiet, and every lantern burns. Emberhold owes you its light, ${p.name}.`], [
        { label: 'Farewell', primary: true, run: () => this.close() },
      ]);
      return;
    }
    const rewards = `Reward: ${quest.xp} XP · ${quest.gold} gold${quest.tonics ? ` · ${quest.tonics} tonic${quest.tonics > 1 ? 's' : ''}` : ''}.`;
    if (p.questState === 'available') {
      this.render(quest.title, 'Elder Maren', [quest.offer, { dim: `${rewards} Recommended ${quest.recommended}.` }], [
        { label: 'Accept quest', primary: true, run: () => { act('questAccept'); this.close(); } },
        { label: 'Not yet', run: () => this.close() },
      ]);
    } else if (p.questState === 'active') {
      this.render(quest.title, 'Elder Maren', [quest.remind, { dim: `Progress: ${quest.label} ${p.questProgress} / ${quest.need}.` }], [
        { label: 'On my way', primary: true, run: () => this.close() },
      ]);
    } else {
      this.render(quest.title, 'Elder Maren', [quest.done, { dim: rewards }], [
        { label: 'Claim reward', primary: true, run: () => { act('questTurnIn'); this.close(); } },
      ]);
    }
  }

  private showShop(p: PlayerProgress, act: (action: NpcAction) => void): void {
    const cost = sharpenCost(p.weapon);
    const maxed = p.weapon >= MAX_WEAPON_TIER;
    this.render('Oda’s Forge', 'Smith Oda', [`Steel and tonics, fair prices. Your blade is at +${p.weapon * 4} attack. You carry ${p.gold} gold.`], [
      { label: `Buy a healing tonic · ${TONIC_PRICE} gold`, primary: true, disabled: p.gold < TONIC_PRICE, run: () => act('buyTonic') },
      maxed
        ? { label: 'Your blade is as sharp as it gets', disabled: true, run: () => undefined }
        : { label: `Sharpen blade (+4 attack) · ${cost} gold`, disabled: p.gold < cost, run: () => act('sharpen') },
      { label: 'Leave', run: () => this.close() },
    ]);
  }

  private render(title: string, who: string, paragraphs: readonly Paragraph[], actions: readonly DialogAction[]): void {
    this.title.textContent = title;
    this.who.textContent = who;
    this.body.replaceChildren(
      ...paragraphs.map((p) => (typeof p === 'string' ? el('p', undefined, p) : el('p', 'dim', p.dim))),
    );
    this.actions.replaceChildren(
      ...actions.map((a) => {
        const button = el('button', `btn ${a.primary ? 'primary' : 'ghost'}`, a.label);
        button.type = 'button';
        button.disabled = a.disabled ?? false;
        button.addEventListener('click', () => {
          button.blur();
          a.run();
        });
        return button;
      }),
    );
    this.root.hidden = false;
  }
}
