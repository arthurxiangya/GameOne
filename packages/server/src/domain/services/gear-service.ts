import {
  AFFIXES,
  BAG_SIZE,
  CLASSES,
  FORGE,
  ILVL_PER_LEVEL,
  MONSTER_DROPS,
  RARITY,
  canWear,
  dropIlvl,
  itemName,
  legendaryFor,
  rollItem,
  rollRarity,
  upgradeCeiling,
  weaponPrice,
  type AffixStat,
  type DropTable,
  type GearSlot,
  type Item,
  type RandomSource,
} from '@lanternwood/shared';
import type { Player } from '../entities/player';
import type { EventSink } from '../events';
import { fail, ok, type Result } from '../result';

type Where = { readonly in: 'bag'; readonly index: number } | { readonly in: 'gear'; readonly slot: GearSlot };

/**
 * Drops, the bag, wearing gear and Smith Oda's forge. Items are replaced, never edited, and so
 * is the hero's `gear` record, so the hero's stats are recomputed exactly when gear changes.
 */
export class GearService {
  constructor(
    private readonly events: EventSink,
    private readonly rng: RandomSource,
  ) {}

  // ------------------------------------------------------------------ drops

  /** A regular monster fell to this hero. */
  monsterKill(hero: Player, monsterLevel: number): void {
    if (this.rng.next() < MONSTER_DROPS.chance) this.drop(hero, MONSTER_DROPS, monsterLevel);
  }

  /** A boss fell near this hero: an item, and sometimes a legendary for their specialization. */
  bossKill(hero: Player, table: DropTable, bossLevel: number): void {
    if (this.rng.next() < table.chance) this.drop(hero, table, bossLevel);
    const spec = hero.spec;
    const legendary = spec ? legendaryFor(spec.id) : null;
    if (legendary && table.legendary && this.rng.next() < table.legendary) {
      const ilvl = dropIlvl(bossLevel, hero.level, table.tier);
      this.give(hero, rollItem(this.rng, this.nextId(hero), { ilvl, tier: table.tier, rarity: 'legendary', legendary: legendary.id }), 'Found');
    }
  }

  private drop(hero: Player, table: DropTable, sourceLevel: number): void {
    const rarity = rollRarity(this.rng, table);
    const set = rarity === 'epic' && table.set && this.rng.next() < table.set.share ? table.set.id : null;
    const ilvl = dropIlvl(sourceLevel, hero.level, table.tier);
    this.give(hero, rollItem(this.rng, this.nextId(hero), { ilvl, tier: table.tier, rarity, set }), 'Found');
  }

  // ------------------------------------------------------------------ the bag

  equip(player: Player, id: number): Result {
    const p = player.progress;
    const index = p.bag.findIndex((i) => i.id === id);
    const item = p.bag[index];
    if (!item) return fail('That item is not in your bag.');
    const blocked = canWear(p.gear, item);
    if (blocked) return fail(blocked);
    const old = p.gear[item.slot];
    player.changeGear(() => {
      p.bag = p.bag.filter((i) => i !== item);
      if (old) p.bag.splice(index, 0, old);
      p.gear = { ...p.gear, [item.slot]: item };
    });
    player.touchProgress();
    this.events.player(player.id, { e: 'log', text: `Equipped ${this.name(player, item)}`, c: 'good' });
    return ok();
  }

  unequip(player: Player, slot: GearSlot): Result {
    const p = player.progress;
    const item = p.gear[slot];
    if (!item) return fail('Nothing is worn there.');
    if (p.bag.length >= BAG_SIZE) return fail('Your bag is full.');
    player.changeGear(() => {
      const gear = { ...p.gear };
      delete gear[slot];
      p.gear = gear;
      p.bag = [...p.bag, item];
    });
    player.touchProgress();
    return ok();
  }

  salvage(player: Player, ids: readonly number[]): Result {
    const p = player.progress;
    const items = p.bag.filter((i) => ids.includes(i.id));
    if (items.length !== ids.length) return fail('Only items in your bag can be salvaged.');
    const embers = items.reduce((sum, i) => sum + RARITY[i.rarity].embers, 0);
    p.bag = p.bag.filter((i) => !items.includes(i));
    p.embers += embers;
    player.touchProgress();
    const what = items.length === 1 ? this.name(player, items[0]!) : `${items.length} items`;
    this.events.player(player.id, { e: 'log', text: `Salvaged ${what} · +${embers} Ember${embers === 1 ? '' : 's'}`, c: 'loot' });
    return ok();
  }

  // ------------------------------------------------------------------ Smith Oda's forge

  /** +5 item level, up to the source's ceiling and five per hero level. */
  upgrade(player: Player, id: number): Result {
    const p = player.progress;
    const at = this.find(player, id);
    if (!at) return fail('You do not have that item.');
    const item = at.item;
    const ceiling = upgradeCeiling(item.tier, player.level);
    if (item.ilvl + FORGE.upgrade.ilvl > ceiling) {
      const sourceCap = upgradeCeiling(item.tier, 99);
      return fail(item.ilvl >= sourceCap ? 'That item is as good as its source allows.' : `Reach level ${Math.ceil((item.ilvl + FORGE.upgrade.ilvl - 5 * item.tier) / ILVL_PER_LEVEL)} to upgrade it further.`);
    }
    if (p.embers < FORGE.upgrade.embers) return fail(`Upgrading costs ${FORGE.upgrade.embers} Embers.`);
    p.embers -= FORGE.upgrade.embers;
    const next = { ...item, ilvl: item.ilvl + FORGE.upgrade.ilvl };
    this.replace(player, at.where, next);
    this.events.player(player.id, { e: 'log', text: `${this.name(player, next)} is now item level ${next.ilvl}`, c: 'good' });
    this.events.area(player.body.x, player.body.z, { e: 'cast', id: player.id });
    return ok();
  }

  /** Turns one affix into another stat. Once an item has been reforged, only that affix can be again. */
  reforge(player: Player, id: number, affix: number, stat: AffixStat): Result {
    const p = player.progress;
    const at = this.find(player, id);
    if (!at) return fail('You do not have that item.');
    const item = at.item;
    const current = item.affixes[affix];
    if (current === undefined) return fail('That item has no such affix.');
    if (item.reforged >= 0 && item.reforged !== affix) return fail(`Only its reforged ${AFFIXES[item.affixes[item.reforged]!].name} can be reforged again.`);
    if (current === stat) return fail(`That affix is already ${AFFIXES[stat].name}.`);
    if (p.embers < FORGE.reforge.embers || p.marks < FORGE.reforge.marks) return fail(`Reforging costs ${FORGE.reforge.embers} Embers and ${FORGE.reforge.marks} Ember Mark.`);
    p.embers -= FORGE.reforge.embers;
    p.marks -= FORGE.reforge.marks;
    const next = { ...item, affixes: item.affixes.map((a, i) => (i === affix ? stat : a)), reforged: affix };
    this.replace(player, at.where, next);
    this.events.player(player.id, { e: 'log', text: `Reforged ${AFFIXES[current].name} into ${AFFIXES[stat].name}`, c: 'good' });
    this.events.area(player.body.x, player.body.z, { e: 'cast', id: player.id });
    return ok();
  }

  /** A rare item for the slot you choose, at five item levels per hero level. */
  craft(player: Player, slot: GearSlot): Result {
    const p = player.progress;
    if (p.bag.length >= BAG_SIZE) return fail('Your bag is full.');
    if (p.embers < FORGE.craft.embers || p.marks < FORGE.craft.marks) return fail(`Crafting costs ${FORGE.craft.embers} Embers and ${FORGE.craft.marks} Ember Marks.`);
    p.embers -= FORGE.craft.embers;
    p.marks -= FORGE.craft.marks;
    this.give(player, rollItem(this.rng, this.nextId(player), { slot, rarity: 'rare', ilvl: ILVL_PER_LEVEL * player.level, tier: 0 }), 'Crafted');
    this.events.area(player.body.x, player.body.z, { e: 'cast', id: player.id });
    return ok();
  }

  /** Oda's plain weapon at your level, for gold. */
  buyWeapon(player: Player): Result {
    const p = player.progress;
    const price = weaponPrice(player.level);
    if (p.bag.length >= BAG_SIZE) return fail('Your bag is full.');
    if (p.gold < price) return fail(`A weapon costs ${price} gold.`);
    p.gold -= price;
    this.give(player, rollItem(this.rng, this.nextId(player), { slot: 'weapon', rarity: 'common', ilvl: ILVL_PER_LEVEL * player.level, tier: 0 }), 'Bought');
    return ok();
  }

  // ------------------------------------------------------------------ helpers

  /** Puts an item in the bag; with the bag full it is salvaged on the spot, so nothing is lost. */
  private give(player: Player, item: Item, verb: string): void {
    const p = player.progress;
    const name = `${RARITY[item.rarity].name} ${this.name(player, item)} (item level ${item.ilvl})`;
    if (p.bag.length >= BAG_SIZE) {
      const embers = RARITY[item.rarity].embers;
      p.embers += embers;
      this.events.player(player.id, { e: 'log', text: `${verb}: ${name}. Bag full: salvaged for ${embers} Ember${embers === 1 ? '' : 's'}`, c: 'loot' });
    } else {
      p.bag = [...p.bag, item];
      this.events.player(player.id, { e: 'log', text: `${verb}: ${name}`, c: 'loot' });
      if (item.rarity === 'epic' || item.rarity === 'legendary') this.events.player(player.id, { e: 'toast', text: `${verb} ${name}! Open your gear (I).` });
    }
    player.touchProgress();
  }

  private nextId(player: Player): number {
    return player.progress.itemSeq++;
  }

  private find(player: Player, id: number): { item: Item; where: Where } | null {
    const p = player.progress;
    const index = p.bag.findIndex((i) => i.id === id);
    if (index >= 0) return { item: p.bag[index]!, where: { in: 'bag', index } };
    for (const [slot, item] of Object.entries(p.gear) as [GearSlot, Item][]) if (item.id === id) return { item, where: { in: 'gear', slot } };
    return null;
  }

  private replace(player: Player, where: Where, next: Item): void {
    const p = player.progress;
    if (where.in === 'bag') p.bag = p.bag.map((i, n) => (n === where.index ? next : i));
    else player.changeGear(() => (p.gear = { ...p.gear, [where.slot]: next }));
    player.touchProgress();
  }

  private name(player: Player, item: Item): string {
    return itemName(item, CLASSES[player.cls].weapon);
  }
}
