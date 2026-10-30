import type { MountId } from './mounts';
import type { PetId } from './pets';
import type { TitleId } from './titles';

export const TONIC_PRICE = 15;
export const STARTING_TONICS = 3;
/** Weapon tiers from before gear (sharpening at Oda's) went up to this. */
export const LEGACY_MAX_WEAPON_TIER = 5;

/** Health restored by a tonic at a given level. */
export const tonicHeal = (level: number): number => 60 + 14 * level;

/** Chance a regular monster drops a tonic. */
export const TONIC_DROP_CHANCE = 0.07;

/** Things Smith Oda sells besides tonics and weapons: for gold, or for Ember Marks. */
export type ShopItemId =
  | 'tonicSatchel'
  | 'lanternbearer'
  | 'strider'
  | 'runner'
  | 'eggFox'
  | 'eggFrog'
  | 'eggBoarlet'
  | 'eggScuttle'
  | 'eggSprite';

export type ShopGrant =
  | { readonly kind: 'tonics'; readonly count: number }
  | { readonly kind: 'title'; readonly title: TitleId }
  | { readonly kind: 'mount'; readonly mount: MountId }
  | { readonly kind: 'egg'; readonly pet: PetId };

export interface ShopItem {
  readonly name: string;
  readonly gold: number;
  readonly marks: number;
  readonly minLevel: number;
  readonly grant: ShopGrant;
}

const egg = (name: string, pet: PetId): ShopItem => ({ name: `${name} egg`, gold: 0, marks: 10, minLevel: 1, grant: { kind: 'egg', pet } });

export const SHOP_ITEMS: Readonly<Record<ShopItemId, ShopItem>> = {
  tonicSatchel: { name: 'Tonic satchel (3 tonics)', gold: 0, marks: 1, minLevel: 1, grant: { kind: 'tonics', count: 3 } },
  lanternbearer: { name: 'Title: Lanternbearer', gold: 0, marks: 8, minLevel: 1, grant: { kind: 'title', title: 'lanternbearer' } },
  strider: { name: 'Mount: Meadow Strider', gold: 250, marks: 0, minLevel: 5, grant: { kind: 'mount', mount: 'strider' } },
  runner: { name: 'Mount: Dune Runner', gold: 0, marks: 20, minLevel: 1, grant: { kind: 'mount', mount: 'runner' } },
  eggFox: egg('Ember Fox', 'fox'),
  eggFrog: egg('Reed Frogling', 'frog'),
  eggBoarlet: egg('Acorn Boarlet', 'boarlet'),
  eggScuttle: egg('Sand Scuttle', 'scuttle'),
  eggSprite: egg('Frost Sprite', 'sprite'),
};

export const SHOP_ITEM_IDS = Object.keys(SHOP_ITEMS) as readonly ShopItemId[];

export const isShopItemId = (v: unknown): v is ShopItemId => typeof v === 'string' && v in SHOP_ITEMS;

/** "250 gold", "10 Ember Marks". */
export const priceText = (item: ShopItem): string =>
  item.gold > 0 ? `${item.gold} gold` : `${item.marks} Ember Mark${item.marks === 1 ? '' : 's'}`;
