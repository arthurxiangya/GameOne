import {
  AFFIXES,
  AFFIX_STATS,
  BAG_SIZE,
  CLASSES,
  CRIT_CHANCE,
  FORGE,
  GEAR_SLOTS,
  LEGENDARIES,
  RARITY,
  SETS,
  SLOT_NAMES,
  TIER_NAMES,
  affixRating,
  heroStats,
  itemName,
  mainLine,
  round1,
  upgradeCeiling,
  type GearOp,
  type Item,
  type PlayerProgress,
} from '@lanternwood/shared';
import { byId, el } from './dom';

export interface GearPanelHandlers {
  send(op: GearOp): void;
}

const pct = (v: number): string => `${round1(v * 100)}%`;
const signed = (v: number): string => `${v >= 0 ? '+' : '−'}${round1(Math.abs(v))}`;

/**
 * The gear panel (I): what you wear and what it adds, your bag, and, at Smith Oda's forge,
 * upgrading, reforging and crafting. Every number comes from the shared rules the server uses.
 */
export class GearPanel {
  private readonly root = byId('gear');
  private readonly body = byId('gBody');
  private last: PlayerProgress | null = null;
  /** The item whose reforge choices are showing. */
  private reforging: number | null = null;
  atForge = false;

  constructor(private readonly handlers: GearPanelHandlers) {
    byId('gClose').addEventListener('click', () => this.close());
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  close(): void {
    this.root.hidden = true;
    this.reforging = null;
  }

  open(p: PlayerProgress): void {
    this.root.hidden = false;
    this.render(p);
  }

  refresh(p: PlayerProgress): void {
    if (this.isOpen) this.render(p);
  }

  setForge(near: boolean): void {
    if (near === this.atForge) return;
    this.atForge = near;
    if (this.isOpen && this.last) this.render(this.last);
  }

  private render(p: PlayerProgress): void {
    this.last = p;
    const now = heroStats(p, p.level);
    const g = now.gear;

    const summary = el('section', 'j-sec');
    summary.append(
      el('h3', undefined, 'What you wear adds'),
      el('p', 'gear-stats', `Power ${round1(now.power)} · Health ${now.maxHp} · Crit ${pct(CRIT_CHANCE + (now.passive.crit ?? 0))} · Haste ${pct(now.passive.haste ?? 0)}`),
      el(
        'p',
        'dim',
        `${CLASSES[p.cls].primary} +${round1(g.power)} · health +${round1(g.health)} · ` +
          AFFIX_STATS.map((s) => `${AFFIXES[s].name} ${round1(g.rating[s])} → +${pct(g.bonus[s])}`).join(' · '),
      ),
      el('p', 'dim', `Each stat gives cap × R ÷ (R + 60), so mixing stats beats stacking one. ${p.embers} Embers · ${p.marks} Ember Marks.`),
    );

    const worn = el('section', 'j-sec');
    worn.append(el('h3', undefined, 'Worn'));
    for (const slot of GEAR_SLOTS) {
      const item = p.gear[slot];
      if (!item) {
        const row = el('div', 'j-row static quiet');
        row.append(el('b', undefined, 'Empty'), el('span', undefined, slot === 'charm' ? 'Charms carry one extra affix instead of a main line.' : 'Monsters, bosses and Smith Oda have gear.'), el('em', undefined, SLOT_NAMES[slot]));
        worn.append(row);
        continue;
      }
      const acts: HTMLElement[] = [this.button('Take off', p.bag.length >= BAG_SIZE, () => this.handlers.send({ kind: 'unequip', slot }))];
      worn.append(this.itemRow(p, item, SLOT_NAMES[slot], [...acts, ...this.forgeButtons(p, item)]));
    }

    const sections: HTMLElement[] = [summary, worn];
    if (g.sets.length > 0 || g.legendary) {
      const bonuses = el('section', 'j-sec');
      bonuses.append(el('h3', undefined, 'Set and legendary'));
      for (const { set, pieces } of g.sets) {
        bonuses.append(
          el('p', pieces >= 2 ? undefined : 'dim', `${set.name} ${pieces}/4 · 2 pieces: ${set.two.text}`),
          el('p', pieces >= 4 ? undefined : 'dim', `${set.name} 4 pieces: ${set.four.text}`),
        );
      }
      if (g.legendary) {
        const on = now.loadout.legendary !== null;
        const spec = CLASSES[p.cls].specs.find((s) => s.id === g.legendary!.spec);
        bonuses.append(el('p', on ? undefined : 'dim', `${g.legendary.name}: ${g.legendary.text}${on ? '' : ` (needs ${spec ? spec.name : 'another class’s specialization'})`}`));
      }
      sections.push(bonuses);
    }

    const bag = el('section', 'j-sec');
    bag.append(el('h3', undefined, `Bag · ${p.bag.length}/${BAG_SIZE}`));
    if (p.bag.length === 0) bag.append(el('p', 'dim', 'Empty. Monsters drop gear now and then; bosses always do.'));
    for (const item of p.bag) {
      const tried = heroStats({ ...p, gear: { ...p.gear, [item.slot]: item } }, p.level);
      const compare = `Power ${signed(tried.power - now.power)} · Health ${signed(tried.maxHp - now.maxHp)}`;
      const acts = [
        this.button('Wear', false, () => this.handlers.send({ kind: 'equip', item: item.id }), true),
        this.button(`Salvage · ${RARITY[item.rarity].embers} Embers`, false, () => this.handlers.send({ kind: 'salvage', items: [item.id] })),
        ...this.forgeButtons(p, item),
      ];
      bag.append(this.itemRow(p, item, compare, acts));
    }
    const commons = p.bag.filter((i) => i.rarity === 'common' || i.rarity === 'uncommon');
    if (commons.length > 1) {
      bag.append(this.button(`Salvage all Common and Uncommon (${commons.length})`, false, () => this.handlers.send({ kind: 'salvage', items: commons.map((i) => i.id) })));
    }
    sections.push(bag);

    const forge = el('section', 'j-sec');
    forge.append(el('h3', undefined, 'Smith Oda’s forge'));
    if (!this.atForge) {
      forge.append(el('p', 'dim', 'Visit Smith Oda in Emberhold to upgrade (+5 item level), reforge an affix, or craft a rare for the slot you choose.'));
    } else {
      const cost = `${FORGE.craft.embers} Embers + ${FORGE.craft.marks} Marks`;
      forge.append(el('p', 'dim', `Craft a rare item at item level ${5 * p.level} for the slot you choose · ${cost}`));
      const chips = el('div', 'chips');
      const short = p.embers < FORGE.craft.embers || p.marks < FORGE.craft.marks || p.bag.length >= BAG_SIZE;
      for (const slot of GEAR_SLOTS) {
        const b = el('button', 'chip', SLOT_NAMES[slot]);
        b.type = 'button';
        b.disabled = short;
        b.addEventListener('click', () => this.handlers.send({ kind: 'craft', slot }));
        chips.append(b);
      }
      forge.append(chips);
    }
    sections.push(forge);

    this.body.replaceChildren(...sections);
  }

  private itemRow(p: PlayerProgress, item: Item, note: string, actions: readonly HTMLElement[]): HTMLElement {
    const row = el('div', 'j-row static gear-row');
    const name = el('b', undefined, itemName(item, CLASSES[p.cls].weapon));
    name.style.color = RARITY[item.rarity].color;
    const lines = [
      `${RARITY[item.rarity].name} ${SLOT_NAMES[item.slot].toLowerCase()} · item level ${item.ilvl}${item.tier > 0 ? ` · ${TIER_NAMES[item.tier]}` : ''}`,
      mainLine(item, CLASSES[p.cls].primary),
      item.affixes.length ? item.affixes.map((a, i) => `+${round1(affixRating(item.ilvl))} ${AFFIXES[a].name}${i === item.reforged ? ' (reforged)' : ''}`).join(', ') : null,
      item.set ? `${SETS[item.set].name} set` : null,
      item.legendary ? LEGENDARIES[item.legendary].text : null,
    ].filter((x): x is string => x !== null);
    row.append(name, el('span', undefined, lines.join(' · ')), el('em', undefined, note));
    const acts = el('div', 'gear-acts');
    acts.append(...actions);
    row.append(acts);
    if (this.reforging === item.id) row.append(this.reforgeChoices(p, item));
    return row;
  }

  /** Upgrade and reforge, shown only at the forge. */
  private forgeButtons(p: PlayerProgress, item: Item): HTMLElement[] {
    if (!this.atForge) return [];
    const ceiling = upgradeCeiling(item.tier, p.level);
    const up = item.ilvl + FORGE.upgrade.ilvl <= ceiling;
    const out = [
      this.button(up ? `Upgrade · ${FORGE.upgrade.embers} Embers` : 'At its ceiling', !up || p.embers < FORGE.upgrade.embers, () =>
        this.handlers.send({ kind: 'upgrade', item: item.id }),
      ),
    ];
    if (item.affixes.length > 0) {
      out.push(
        this.button(this.reforging === item.id ? 'Close reforge' : 'Reforge', false, () => {
          this.reforging = this.reforging === item.id ? null : item.id;
          this.render(p);
        }),
      );
    }
    return out;
  }

  private reforgeChoices(p: PlayerProgress, item: Item): HTMLElement {
    const box = el('div', 'gear-reforge');
    const short = p.embers < FORGE.reforge.embers || p.marks < FORGE.reforge.marks;
    box.append(el('p', 'dim', `Turn one affix into another stat · ${FORGE.reforge.embers} Embers + ${FORGE.reforge.marks} Mark. After the first, only that affix can be reforged again.`));
    item.affixes.forEach((a, i) => {
      if (item.reforged >= 0 && item.reforged !== i) return;
      const line = el('div', 'chips');
      line.append(el('span', 'gear-from', `${AFFIXES[a].name} →`));
      for (const stat of AFFIX_STATS) {
        if (stat === a) continue;
        const b = el('button', 'chip', AFFIXES[stat].name);
        b.type = 'button';
        b.disabled = short;
        b.addEventListener('click', () => {
          this.reforging = null;
          this.handlers.send({ kind: 'reforge', item: item.id, affix: i, stat });
        });
        line.append(b);
      }
      box.append(line);
    });
    return box;
  }

  private button(label: string, disabled: boolean, onClick: () => void, primary = false): HTMLButtonElement {
    const b = el('button', `btn ${primary ? 'primary' : 'ghost'} small`, label);
    b.type = 'button';
    b.disabled = disabled;
    b.addEventListener('click', onClick);
    return b;
  }
}
