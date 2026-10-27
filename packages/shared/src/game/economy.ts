export const TONIC_PRICE = 15;
export const MAX_WEAPON_TIER = 5;
export const STARTING_TONICS = 3;

/** Gold needed to sharpen from `tier` to `tier + 1`. */
export const sharpenCost = (tier: number): number => 40 * (tier + 1);

/** Health restored by a tonic at a given level. */
export const tonicHeal = (level: number): number => 60 + 14 * level;

/** Chance a regular monster drops a tonic. */
export const TONIC_DROP_CHANCE = 0.07;
