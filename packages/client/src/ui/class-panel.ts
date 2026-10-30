import {
  CLASSES,
  CLASS_IDS,
  RESOURCES,
  SPEC_LEVEL,
  TALENTS,
  TALENT_LEVELS,
  TALENT_ROW_THEMES,
  describeSkill,
  kitFor,
  loadout,
  powerFor,
  type ClassId,
  type PlayerProgress,
  type Role,
  type SpecId,
} from '@lanternwood/shared';
import { byId, el } from './dom';
import { iconSvg } from './skill-icons';

export interface ClassPanelHandlers {
  /** Ask the server for this class and spec. */
  choose(cls: ClassId, spec: SpecId | null): void;
  /** Pick a talent for your current class (or clear the row with null). */
  talent(row: number, pick: number | null): void;
}

export const ROLE_NAMES: Readonly<Record<Role, string>> = { tank: 'Tank', healer: 'Healer', damage: 'Damage', support: 'Support' };

/** The class panel (C): your class's skills with real numbers, the five classes, and specializations. */
export class ClassPanel {
  private readonly root = byId('classes');
  private readonly body = byId('cBody');
  private viewing: ClassId | null = null;
  private last: PlayerProgress | null = null;

  constructor(private readonly handlers: ClassPanelHandlers) {
    byId('cClose').addEventListener('click', () => this.close());
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  close(): void {
    this.root.hidden = true;
    this.viewing = null;
  }

  open(p: PlayerProgress): void {
    this.root.hidden = false;
    this.viewing = p.cls;
    this.render(p);
  }

  refresh(p: PlayerProgress): void {
    if (!this.isOpen) return;
    // After a successful change, follow the hero into the new class.
    if (this.last && this.last.cls !== p.cls) this.viewing = p.cls;
    this.render(p);
  }

  private render(p: PlayerProgress): void {
    this.last = p;
    const cls = this.viewing ?? p.cls;
    const def = CLASSES[cls];
    const mine = cls === p.cls;
    const gear = loadout(cls, p, p.level);
    const power = powerFor(p.level, p.weapon);
    const passive = gear.passive;

    const picker = el('div', 'chips cls-tabs');
    for (const id of CLASS_IDS) {
      const b = el('button', `chip${id === cls ? ' on' : ''}`, CLASSES[id].name);
      b.type = 'button';
      b.setAttribute('aria-pressed', String(id === cls));
      b.style.setProperty('--cls', CLASSES[id].color);
      b.addEventListener('click', () => {
        this.viewing = id;
        this.render(p);
      });
      picker.append(b);
    }

    const about = el('section', 'j-sec');
    about.append(
      el('h3', undefined, `${ROLE_NAMES[def.role]} · ${def.primary} · ${RESOURCES[def.resource.kind].name}`),
      el('p', undefined, def.fantasy),
      el('p', 'dim', `Strong: ${def.strengths} Weak: ${def.weaknesses}`),
      el('p', 'dim', `Health ×${def.health} · armour ${Math.round(def.armor * 100)}%${def.threat > 1 ? ` · threat ×${def.threat}` : ''}`),
    );
    if (!mine) {
      const become = el('button', 'btn primary', `Become a ${def.name}`);
      become.type = 'button';
      become.addEventListener('click', () => this.handlers.choose(cls, p.specs[cls] ?? null));
      about.append(become, el('p', 'dim', 'Free. In Emberhold, out of combat. Your level, gold and stories stay with you.'));
    }

    const skills = el('section', 'j-sec');
    skills.append(el('h3', undefined, mine ? `Your skills at ${Math.round(power)} Power` : `Skills at ${Math.round(power)} Power`));
    for (const s of mine ? gear.kit : kitFor(cls, null)) {
      const row = el('div', `j-row static skill-row${p.level < s.unlockLevel ? ' quiet' : ''}`);
      const icon = el('i', 'skill-ico');
      icon.innerHTML = iconSvg(s.icon);
      const cost = s.cost > 0 ? `${s.cost} ${RESOURCES[def.resource.kind].name}` : s.gain > 0 ? `+${s.gain} ${RESOURCES[def.resource.kind].name}` : 'Free';
      row.append(
        icon,
        el('b', undefined, s.name),
        el('span', undefined, describeSkill(s, power, passive.damage ?? 0, passive.healing ?? 0)),
        el('em', undefined, p.level < s.unlockLevel ? `Lv ${s.unlockLevel}` : `${cost} · ${s.cooldown}s`),
      );
      skills.append(row);
    }

    const specs = el('section', 'j-sec');
    specs.append(el('h3', undefined, 'Specialization'));
    if (p.level < SPEC_LEVEL) specs.append(el('p', 'dim', `Opens at level ${SPEC_LEVEL}: one passive and one skill change. Switch freely out of combat.`));
    for (const s of def.specs) {
      const chosen = p.specs[cls] === s.id;
      const row = el('button', `j-row${chosen ? ' on' : ''}`);
      row.type = 'button';
      row.disabled = !mine || p.level < SPEC_LEVEL;
      row.append(el('b', undefined, `${s.name} · ${s.leaning}`), el('span', undefined, `${s.passiveText} ${s.changeText}`));
      if (chosen) row.append(el('em', undefined, 'Chosen'));
      row.addEventListener('click', () => this.handlers.choose(cls, chosen ? null : s.id));
      specs.append(row);
    }
    if (!mine && p.level >= SPEC_LEVEL) specs.append(el('p', 'dim', `Become a ${def.name} to choose.`));

    const talents = el('section', 'j-sec');
    talents.append(el('h3', undefined, 'Talents'));
    talents.append(el('p', 'dim', 'One choice per row. Free to change out of combat.'));
    const picks = p.talents[cls] ?? [];
    TALENTS[cls].forEach((options, row) => {
      const needed = TALENT_LEVELS[row]!;
      const open = p.level >= needed;
      talents.append(el('p', 'talent-row', `${TALENT_ROW_THEMES[row]} · level ${needed}${open ? '' : ' (locked)'}`));
      const group = el('div', 'talent-opts');
      options.forEach((t, i) => {
        const chosen = picks[row] === t.id;
        const b = el('button', `j-row talent${chosen ? ' on' : ''}`);
        b.type = 'button';
        b.disabled = !mine || !open;
        b.setAttribute('aria-pressed', String(chosen));
        b.append(el('b', undefined, t.name), el('span', undefined, t.text));
        b.addEventListener('click', () => this.handlers.talent(row, chosen ? null : i));
        group.append(b);
      });
      talents.append(group);
    });

    this.body.replaceChildren(picker, about, skills, specs, talents);
  }
}
