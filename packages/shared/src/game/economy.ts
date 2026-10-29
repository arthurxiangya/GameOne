export const TONIC_PRICE = 15;
export const MAX_WEAPON_TIER = 5;
export const STARTING_TONICS = 3;

/** Gold needed to sharpen from `tier` to `tier + 1`. */
export const sharpenCost = (tier: number): number => 40 * (tier + 1);

/** Health restored by a tonic at a given level. */
export const tonicHeal = (level: number): number => 60 + 14 * level;

/** Chance a regular monster drops a tonic. */
export const TONIC_DROP_CHANCE = 0.07;

/** Things Smith Oda trades for Ember Marks. */
export type ShopItemId = 'tonicSatchel' | 'lanternbearer';

export interface ShopItem {
  readonly name: string;
  readonly marks: number;
  readonly text: string;
}

export const MARK_SHOP: Readonly<Record<ShopItemId, ShopItem>> = {
  tonicSatchel: { name: 'Tonic satchel', marks: 1, text: 'Three healing tonics' },
  lanternbearer: { name: 'Title: Lanternbearer', marks: 8, text: 'Show it under your name' },
};

export const SHOP_ITEM_IDS = Object.keys(MARK_SHOP) as readonly ShopItemId[];

export const isShopItemId = (v: unknown): v is ShopItemId => typeof v === 'string' && v in MARK_SHOP;

/** Tonics in a satchel. */
export const SATCHEL_TONICS = 3;
