import { MAX_WEAPON_TIER, TONIC_PRICE, sharpenCost } from '@lanternwood/shared';
import type { Player } from '../entities/player';
import type { EventSink } from '../events';
import { fail, ok, type Result } from '../result';

/** Smith Oda's forge. */
export class ShopService {
  constructor(private readonly events: EventSink) {}

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
