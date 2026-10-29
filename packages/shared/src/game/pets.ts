import type { MonsterType } from './monsters';

/** Pets follow their hero, level up alongside them and give one small bonus each. They never fight. */
export type PetId = 'fox' | 'frog' | 'boarlet' | 'scuttle' | 'sprite' | 'moth' | 'mote';

/** What a pet improves. Every bonus is a fraction (0.1 = +10%). */
export type PetBonus = 'gold' | 'mana' | 'tonicHeal' | 'tonicDrops' | 'mend' | 'xp';

export interface PetDef {
  readonly name: string;
  /** Monster that drops this pet's egg, or null for pets earned in modes. */
  readonly eggFrom: MonsterType | null;
  readonly how: string;
  /** Bonuses at pet level 10. */
  readonly bonus: Readonly<Partial<Record<PetBonus, number>>>;
  readonly describe: string;
}

export const PETS: Readonly<Record<PetId, PetDef>> = {
  fox: { name: 'Ember Fox', eggFrom: 'puffcap', how: 'Egg from Puffcaps in Sunmeadow', bonus: { gold: 0.1 }, describe: 'gold from monsters' },
  frog: { name: 'Reed Frogling', eggFrom: 'toad', how: 'Egg from Bog Toads in Reedmere', bonus: { mana: 0.15 }, describe: 'mana regeneration' },
  boarlet: { name: 'Acorn Boarlet', eggFrom: 'boar', how: 'Egg from Bramble Boars in Lanternwood', bonus: { tonicHeal: 0.15 }, describe: 'healing from tonics' },
  scuttle: { name: 'Sand Scuttle', eggFrom: 'scuttler', how: 'Egg from Dune Scuttlers in the Amber Dunes', bonus: { tonicDrops: 0.5 }, describe: 'chance of tonic drops' },
  sprite: { name: 'Frost Sprite', eggFrom: 'golem', how: 'Egg from Frost Golems in Frostspine', bonus: { mend: 0.15 }, describe: 'healing from Mend' },
  moth: { name: 'Gloom Moth', eggFrom: null, how: 'Rarely found after winning a Lantern Night', bonus: { xp: 0.1 }, describe: 'XP from monsters' },
  mote: { name: 'Rift Mote', eggFrom: null, how: 'Your first Rift Lord defeat', bonus: { xp: 0.05, gold: 0.05 }, describe: 'XP and gold from monsters' },
};

export const PET_IDS = Object.keys(PETS) as readonly PetId[];

export const isPetId = (v: unknown): v is PetId => typeof v === 'string' && v in PETS;

export const PET_MAX_LEVEL = 10;
/** Chance a zone monster drops its zone's egg, if the hero has neither that pet nor its egg. */
export const EGG_DROP_CHANCE = 0.01;
/** Monsters to defeat with an egg in your bag before it hatches. */
export const EGG_HATCH_KILLS = 20;
/** Eggs a hero can carry at once. */
export const MAX_EGGS = 3;
/** Share of the hero's XP the active pet earns. */
export const PET_XP_SHARE = 0.5;

/** Pet XP needed to go from `level` to `level + 1`. */
export const petXpToNext = (level: number): number => 150 * level;

export interface PetState {
  id: PetId;
  name: string;
  level: number;
  xp: number;
}

export interface EggState {
  pet: PetId;
  /** Monsters defeated since the egg was found. */
  kills: number;
}

/** The pet whose egg `monster` drops, if any. */
export const petForMonster = (monster: MonsterType): PetId | null => PET_IDS.find((id) => PETS[id].eggFrom === monster) ?? null;

/** A pet's bonus at its level: a tenth of the full amount at level 1, all of it at level 10. */
export const petBonusAt = (pet: PetId, level: number, kind: PetBonus): number =>
  ((PETS[pet].bonus[kind] ?? 0) * Math.min(PET_MAX_LEVEL, Math.max(1, level))) / PET_MAX_LEVEL;

/** The active pet's bonus for a hero, or 0. */
export function activePetBonus(p: { readonly pet: PetId | null; readonly pets: readonly PetState[] }, kind: PetBonus): number {
  if (!p.pet) return 0;
  const pet = p.pets.find((x) => x.id === p.pet);
  return pet ? petBonusAt(pet.id, pet.level, kind) : 0;
}
