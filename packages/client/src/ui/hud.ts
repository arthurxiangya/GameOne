import {
  MAX_LEVEL,
  MONSTERS,
  SKILLS,
  questAt,
  xpToNext,
  type EntityState,
  type PlayerProgress,
  type SelfState,
  type SkillId,
} from '@lanternwood/shared';
import { byId, setText, svgById } from './dom';

const SKILL_KEYS: readonly SkillId[] = ['strike', 'bolt', 'mend', 'ring', 'tonic'];

/** Player frame, target frame, skill cooldowns, quest tracker and clock. Writes the DOM only on change. */
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
  private readonly skillButtons = new Map<SkillId, HTMLElement>();
  private readonly skillCooldown = new Map<SkillId, number>();
  private lastVitals = '';
  private lastMinute = -1;

  constructor() {
    for (const id of SKILL_KEYS) {
      const button = document.querySelector<HTMLElement>(`.sk[data-skill="${id}"]`);
      if (button) this.skillButtons.set(id, button);
    }
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
    for (const [id, button] of this.skillButtons) button.classList.toggle('locked', p.level < SKILLS[id].unlockLevel);
    this.setQuest(p);
  }

  setVitals(self: SelfState): void {
    const key = `${self.hp}/${self.mhp}/${self.mp}/${self.mmp}`;
    if (key !== this.lastVitals) {
      this.lastVitals = key;
      this.hpFill.style.transform = `scaleX(${(self.hp / self.mhp).toFixed(3)})`;
      setText(this.hpText, `${self.hp} / ${self.mhp}`);
      this.mpFill.style.transform = `scaleX(${(self.mp / self.mmp).toFixed(3)})`;
      setText(this.mpText, `${self.mp} / ${self.mmp}`);
    }
    for (const [id, button] of this.skillButtons) button.classList.toggle('nomana', SKILLS[id].mana > self.mp);
  }

  /** Cooldowns are counted down locally between snapshots for smooth sweeps. */
  setCooldowns(remaining: Readonly<Record<SkillId, number>>): void {
    for (const [id, button] of this.skillButtons) {
      const fraction = Math.round(Math.max(0, Math.min(1, remaining[id] / SKILLS[id].cooldown)) * 50) / 50;
      if (fraction !== this.skillCooldown.get(id)) {
        this.skillCooldown.set(id, fraction);
        button.style.setProperty('--cd', String(fraction));
      }
    }
  }

  setTarget(target: EntityState | null): void {
    this.targetFrame.hidden = target === null;
    if (!target) return;
    const isMonster = target.k === 'm';
    setText(this.targetName, isMonster ? MONSTERS[target.ty].name : target.nm);
    this.targetFrame.classList.toggle('ally', !isMonster);
    this.targetFrame.classList.toggle('boss', isMonster && target.ty === 'warden');
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

  private setQuest(p: PlayerProgress): void {
    const quest = questAt(p.quest);
    let kind = 'Quest';
    let title: string;
    let objective: string;
    let where: string;
    if (!quest || p.questState === 'done') {
      kind = 'Realm';
      title = 'Hero of the Realm';
      objective = 'Every quest is complete';
      where = 'Explore and hunt freely';
    } else if (p.questState === 'available') {
      kind = 'New quest';
      title = 'Elder Maren has work';
      objective = 'Talk to her by the fountain';
      where = 'Emberhold · the gold ! on your map';
    } else if (p.questState === 'active') {
      title = quest.title;
      objective = `${quest.label} ${p.questProgress} / ${quest.need}`;
      where = quest.where;
    } else {
      kind = 'Turn in';
      title = quest.title;
      objective = 'Return to Elder Maren';
      where = 'Emberhold · the gold ? on your map';
    }
    setText(this.questKind, kind);
    setText(this.questTitle, title);
    setText(this.questObjective, objective);
    setText(this.questWhere, where);
  }
}
