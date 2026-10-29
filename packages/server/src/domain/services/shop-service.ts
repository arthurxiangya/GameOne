import { MAX_WEAPON_TIER, SHOP_ITEMS, TONIC_PRICE, priceText, sharpenCost, type ShopItemId } from '@lanternwood/shared';
import type { Player } from '../entities/player';
import type { EventSink } from '../events';
import { fail, ok, type Result } from '../result';
import type { PetService } from './pet-service';
import type { ProgressionService } from './progression-service';

/** Smith Oda's forge, and what she sells for gold and Ember Marks. */
export class ShopService {
  constructor(
    private readonly events: EventSink,
    private readonly progression: ProgressionService,
    private readonly pets: PetService,
  ) {}

  buy(player: Player, id: ShopItemId): Result {
    const p = player.progress;
    const item = SHOP_ITEMS[id];
    const grant = item.grant;
    if (p.level < item.minLevel) return fail(`${item.name} is for heroes of level ${item.minLevel} and up.`);
    if (grant.kind === 'title' && p.titles.includes(grant.title)) return fail('You already carry that title.');
    if (grant.kind === 'mount' && p.mounts.includes(grant.mount)) return fail('That mount is already yours.');
    if (grant.kind === 'egg' && !this.pets.canTakeEgg(player, grant.pet)) {
      return fail(p.pets.some((x) => x.id === grant.pet) ? 'You already have that pet.' : 'You cannot carry that egg right now.');
    }
    if (p.gold < item.gold || p.marks < item.marks) return fail(`${item.name} costs ${priceText(item)}.`);
    p.gold -= item.gold;
    p.marks -= item.marks;
    player.touchProgress();
    switch (grant.kind) {
      case 'tonics':
        p.tonics += grant.count;
        this.events.player(player.id, { e: 'log', text: `Traded for ${grant.count} healing tonics`, c: 'loot' });
        break;
      case 'title':
        this.progression.grantTitle(player, grant.title);
        break;
      case 'mount':
        this.progression.grantMount(player, grant.mount);
        break;
      case 'egg':
        this.pets.giveEgg(player, grant.pet);
        break;
    }
    return ok();
  }

  buyTonic(player: Player): Result {
    const p = player.progress;
    if (p.gold < TONIC_PRICE) return fail(`You need ${TONIC_PRICE} gold for a tonic.`);
    p.gold -= TONIC_PRICE;
    p.tonics += 1;
    player.touchProgress();
    this.events.player(player.id, { e: 'log', text: 'Bought a healing tonic', c: 'loot' });
    return ok();
  }

  sharpen(player: Player): Result {
    const p = player.progress;
    if (p.weapon >= MAX_WEAPON_TIER) return fail('Your blade is as sharp as it gets.');
    const cost = sharpenCost(p.weapon);
    if (p.gold < cost) return fail(`Sharpening costs ${cost} gold.`);
    p.gold -= cost;
    p.weapon += 1;
    player.touchProgress();
    this.events.player(player.id, { e: 'log', text: `Your blade is now +${p.weapon * 4} attack`, c: 'good' });
    this.events.area(player.body.x, player.body.z, { e: 'cast', id: player.id });
    return ok();
  }
}
