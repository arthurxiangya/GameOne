import {
  MAX_LEVEL,
  MOUNTS,
  PET_MAX_LEVEL,
  PET_XP_SHARE,
  SKILLS,
  SKILL_IDS,
  TITLES,
  petXpToNext,
  xpToNext,
  type MountId,
  type TitleId,
} from '@lanternwood/shared';
import type { Player } from '../entities/player';
import type { EventSink } from '../events';

/** Experience (the hero's and their pet's), levels, gold, Ember Marks, titles and mounts. */
export class ProgressionService {
  constructor(private readonly events: EventSink) {}

  grantXp(player: Player, amount: number): void {
    if (amount <= 0) return;
    this.feedPet(player, amount);
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

  grantMount(player: Player, mount: MountId): void {
    const p = player.progress;
    if (p.mounts.includes(mount)) return;
    p.mounts.push(mount);
    if (p.mount === null) p.mount = mount;
    player.touchProgress();
    this.events.player(player.id, { e: 'banner', title: MOUNTS[mount].name, text: 'New mount · press R to ride' });
    this.events.player(player.id, { e: 'log', text: `${MOUNTS[mount].name} is yours. Press R to ride (P to choose a mount).`, c: 'good' });
  }

  /** The active pet earns a share of the hero's XP, even once the hero is at the level cap. */
  private feedPet(player: Player, amount: number): void {
    const p = player.progress;
    const pet = p.pet ? p.pets.find((x) => x.id === p.pet) : undefined;
    if (!pet || pet.level >= PET_MAX_LEVEL) return;
    pet.xp += Math.round(amount * PET_XP_SHARE);
    while (pet.level < PET_MAX_LEVEL && pet.xp >= petXpToNext(pet.level)) {
      pet.xp -= petXpToNext(pet.level);
      pet.level += 1;
      this.events.player(player.id, { e: 'toast', text: `${pet.name} reached level ${pet.level}` });
    }
    if (pet.level >= PET_MAX_LEVEL) pet.xp = 0;
    player.touchProgress();
  }
}
