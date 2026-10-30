import { clamp } from '../math/scalar';

export const MAX_LEVEL = 20;
export const CRIT_CHANCE = 0.15;
export const CRIT_MULTIPLIER = 1.6;

export const maxHpFor = (level: number): number => 90 + 24 * (level - 1);
export const attackFor = (level: number, weaponTier: number): number => 10 + 3.4 * (level - 1) + 4 * weaponTier;

/** Experience needed to advance from `level` to `level + 1`. */
export const xpToNext = (level: number): number => Math.round(30 * level * (1 + 0.25 * level));

/** Experience for a kill, scaled by the level gap so low-level farming stops paying. */
export function killXp(monsterLevel: number, playerLevel: number, boss: boolean): number {
  const gap = clamp(1 + (monsterLevel - playerLevel) * 0.12, 0.25, 1.4);
  return Math.round((18 + 11 * monsterLevel) * gap * (boss ? 6 : 1));
}

/** Gold for a kill; `roll` is a uniform random number in [0, 1). */
export function killGold(monsterLevel: number, boss: boolean, roll: number): number {
  return monsterLevel + Math.floor(roll * (monsterLevel + 1)) + (boss ? 150 : 0);
}

/** Monsters this many levels above the player hit harder. */
export const outlevelledDamageMultiplier = (monsterLevel: number, playerLevel: number): number =>
  monsterLevel > playerLevel + 2 ? 1.25 : 1;

/** Health regeneration. Each class's resource has its own rates (see `classes.ts`). */
export const REGEN = {
  /** Fraction of max HP per second once out of combat. */
  healthFractionPerSecond: 0.04,
  /** Seconds without taking damage before health regenerates. */
  healthDelaySeconds: 5,
} as const;
