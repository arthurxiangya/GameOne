import {
  CLASSES,
  MAX_LEVEL,
  MONSTERS,
  RESOURCES,
  TONIC,
  describeSkill,
  xpToNext,
  type ClassId,
  type EntityState,
  type Passive,
  type PlayerProgress,
  type SelfState,
  type SelfStatus,
  type SkillDef,
  type SkillId,
} from '@lanternwood/shared';
import type { TrackerInfo } from '../app/objectives';
import { byId, el, setText, svgById } from './dom';
import { iconSvg } from './skill-icons';

/** Player frame, target frame, skill cooldowns, story tracker and clock. Writes the DOM only on change. */
export class Hud {
  private readonly name = byId('pName');
  private readonly level = byId('pLv');
  private readonly hpFill = byId('hpFill');
  private readonly hpText = byId('hpText');
  private readonly mpFill = byId('mpFill');
  private readonly mpText = byId('mpText');
  private readonly xpFill = byId('xpFill');
  private readonly xpText = byId('xpText');
  private readonly gold = byId('gold');
  private readonly tonics = byId('potCount');
  private readonly tonicBadge = byId('potBadge');
  private readonly targetFrame = byId('tframe');
  private readonly targetName = byId('tName');
  private readonly targetLevel = byId('tLv');
  private readonly targetFill = byId('tFill');
  private readonly targetText = byId('tText');
  private readonly questKind = byId('qKind');
  private readonly questTitle = byId('qTitle');
  private readonly questObjective = byId('qObj');
  private readonly questWhere = byId('qWhere');
  private readonly clock = byId('clock');
  private readonly phase = byId('phase');
  private readonly ping = byId('ping');
  private readonly fps = byId('fps');
  private readonly sun = svgById('clkSun');
  private readonly moon = svgById('clkMoon');
  private readonly hurt = byId('hurtfx');
  private readonly mpLabel = byId('mpLabel');
  private readonly statusRow = byId('pStatus');
  private readonly slotButtons = [0, 1, 2, 3].map((i) => byId(`sk${i}`));
  private readonly tonicButton = byId('skTonic');
  /** The skill in each button, the four slots then the tonic. */
  private buttons: { def: SkillDef; button: HTMLElement }[] = [];
  private readonly skillCooldown = new Map<HTMLElement, number>();
  private resourceName = '';
  private lastKit = '';
  private lastStatuses = '';
  private lastVitals = '';
  private lastMinute = -1;

  /** Puts the class's skills on the buttons: icons, names, tooltips with real numbers, and lock labels. */
  setKit(cls: ClassId, kit: readonly SkillDef[], power: number, passive: Passive): void {
    const key = `${cls}/${kit.map((s) => `${s.id}:${s.text.length}:${s.cooldown}:${s.cost}`).join()}/${Math.round(power)}/${passive.damage ?? 0}/${passive.healing ?? 0}`;
    if (key === this.lastKit) return;
    this.lastKit = key;
    const def = CLASSES[cls];
    this.resourceName = RESOURCES[def.resource.kind].name;
    document.documentElement.style.setProperty('--res', RESOURCES[def.resource.kind].color);
    setText(this.mpLabel, this.resourceName);
    this.buttons = kit.map((s, i) => ({ def: s, button: this.slotButtons[i]! }));
    for (const { def: s, button } of this.buttons) {
      button.querySelector('svg')?.remove();
      button.insertAdjacentHTML('afterbegin', iconSvg(s.icon));
      const tip = `${s.name}: ${describeSkill(s, power, passive.damage ?? 0, passive.healing ?? 0)}`;
      button.setAttribute('aria-label', tip);
      button.title = tip;
      const lock = button.querySelector('.lock');
      if (lock) lock.textContent = `Lv ${s.unlockLevel}`;
    }
    this.buttons.push({ def: TONIC, button: this.tonicButton });
    this.lastVitals = '';
  }

  setProgress(p: PlayerProgress): void {
    setText(this.name, p.name);
    setText(this.level, String(p.level));
    setText(this.gold, p.gold.toLocaleString('en-US'));
    setText(this.tonics, String(p.tonics));
    setText(this.tonicBadge, String(p.tonics));
    const need = xpToNext(p.level);
    this.xpFill.style.transform = `scaleX(${p.level >= MAX_LEVEL ? 1 : Math.min(1, p.xp / need).toFixed(3)})`;
    setText(this.xpText, p.level >= MAX_LEVEL ? 'Max level' : `${p.xp} / ${need} XP`);
    for (const { def, button } of this.buttons) button.classList.toggle('locked', p.level < def.unlockLevel);
  }

  setVitals(self: SelfState): void {
    const key = `${self.hp}/${self.mhp}/${self.mp}/${self.mmp}`;
    if (key !== this.lastVitals) {
      this.lastVitals = key;
      this.hpFill.style.transform = `scaleX(${(self.hp / self.mhp).toFixed(3)})`;
      setText(this.hpText, `${self.hp} / ${self.mhp}`);
      this.mpFill.style.transform = `scaleX(${(self.mp / Math.max(1, self.mmp)).toFixed(3)})`;
      setText(this.mpText, `${self.mp} / ${self.mmp}`);
      for (const { def, button } of this.buttons) button.classList.toggle('nomana', def.cost > self.mp);
    }
    this.setStatuses(self.st, self.sh);
  }

  /** Buffs and debuffs on you, and your ward, as small chips under your frame. */
  private setStatuses(statuses: readonly SelfStatus[], shield: number): void {
    const key = statuses.map((s) => `${s.id}:${Math.ceil(s.left)}`).join() + `/${shield}`;
    if (key === this.lastStatuses) return;
    this.lastStatuses = key;
    const chips = statuses.map((s) => el('span', `st-chip${s.good ? ' good' : ' bad'}`, `${s.name} ${Math.ceil(s.left)}s`));
    if (shield > 0) chips.push(el('span', 'st-chip good', `Ward ${shield}`));
    this.statusRow.replaceChildren(...chips);
  }

  /** Cooldowns are counted down locally between snapshots for smooth sweeps. */
  setCooldowns(remaining: Readonly<Partial<Record<SkillId, number>>>): void {
    for (const { def, button } of this.buttons) {
      const fraction = Math.round(Math.max(0, Math.min(1, (remaining[def.id] ?? 0) / def.cooldown)) * 50) / 50;
      if (fraction !== this.skillCooldown.get(button)) {
        this.skillCooldown.set(button, fraction);
        button.style.setProperty('--cd', String(fraction));
      }
    }
  }

  setTarget(target: EntityState | null): void {
    this.targetFrame.hidden = target === null;
    if (!target) return;
    const isMonster = target.k === 'm';
    setText(this.targetName, isMonster ? MONSTERS[target.ty].name : `${target.nm} · ${CLASSES[target.cl].name}`);
    this.targetFrame.classList.toggle('ally', !isMonster);
    this.targetFrame.classList.toggle('boss', isMonster && MONSTERS[target.ty].boss);
    setText(this.targetLevel, String(target.lv));
    this.targetFill.style.transform = `scaleX(${(Math.max(0, target.hp) / target.mhp).toFixed(3)})`;
    setText(this.targetText, `${Math.max(0, target.hp)} / ${target.mhp}`);
  }

  setClock(timeOfDay: number): void {
    const minutes = Math.floor(timeOfDay * 24 * 60) % 1440;
    if (minutes === this.lastMinute) return;
    this.lastMinute = minutes;
    const hours = minutes / 60;
    setText(this.clock, `${String(Math.floor(hours)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`);
    setText(this.phase, hours < 5 ? 'Night' : hours < 7 ? 'Dawn' : hours < 12 ? 'Morning' : hours < 17 ? 'Afternoon' : hours < 19 ? 'Dusk' : 'Night');
    const isDay = hours >= 6 && hours < 18;
    this.sun.setAttribute('visibility', isDay ? 'visible' : 'hidden');
    this.moon.setAttribute('visibility', isDay ? 'hidden' : 'visible');
  }

  setPing(ms: number | null): void {
    setText(this.ping, ms === null ? '— ms' : `${Math.round(ms)} ms`);
  }

  setFps(fps: number): void {
    setText(this.fps, `${Math.round(fps)} fps`);
  }

  setHurt(amount: number): void {
    this.hurt.style.opacity = amount.toFixed(2);
  }

  setTracker(info: TrackerInfo): void {
    setText(this.questKind, info.kind);
    setText(this.questTitle, info.title);
    setText(this.questObjective, info.objective);
    setText(this.questWhere, info.where);
  }
}
