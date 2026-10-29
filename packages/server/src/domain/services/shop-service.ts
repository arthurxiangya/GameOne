import { MARK_SHOP, MAX_WEAPON_TIER, SATCHEL_TONICS, TONIC_PRICE, sharpenCost, type ShopItemId } from '@lanternwood/shared';
import type { Player } from '../entities/player';
import type { EventSink } from '../events';
import { fail, ok, type Result } from '../result';
import type { ProgressionService } from './progression-service';

/** Smith Oda's forge, and her trades for Ember Marks. */
export class ShopService {
  constructor(
    private readonly events: EventSink,
    private readonly progression: ProgressionService,
  ) {}

  buy(player: Player, item: ShopItemId): Result {
    const p = player.progress;
    const def = MARK_SHOP[item];
    if (item === 'lanternbearer' && p.titles.includes('lanternbearer')) return fail('You already carry that title.');
    if (p.marks < def.marks) return fail(`${def.name} costs ${def.marks} Ember Mark${def.marks > 1 ? 's' : ''}.`);
    p.marks -= def.marks;
    player.touchProgress();
    switch (item) {
      case 'tonicSatchel':
        p.tonics += SATCHEL_TONICS;
        this.events.player(player.id, { e: 'log', text: `Traded for ${SATCHEL_TONICS} healing tonics`, c: 'loot' });
        break;
      case 'lanternbearer':
        this.progression.grantTitle(player, 'lanternbearer');
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
