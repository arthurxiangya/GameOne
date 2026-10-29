import { MOUNTS, MOUNT_CALL_SECONDS, MOUNT_COMBAT_LOCK_SECONDS, type MountId } from '@lanternwood/shared';
import type { Player } from '../entities/player';
import type { EventSink } from '../events';
import type { Clock } from '../ports';
import { fail, ok, type Result } from '../result';

/**
 * Calling, riding and leaving mounts. Riding only changes movement speed, which the shared
 * physics step takes as a parameter, so prediction and the server always agree.
 */
export class MountService {
  constructor(
    private readonly events: EventSink,
    private readonly clock: Clock,
  ) {}

  call(player: Player): Result {
    const p = player.progress;
    if (player.dead) return fail('You are defeated.');
    if (player.riding) return fail('You are already riding.');
    if (player.calling > 0) return ok();
    if (!p.mount) return fail(p.mounts.length ? 'Choose a mount in your stable (P).' : 'You have no mount yet. Smith Oda sells one at level 5.');
    const now = this.clock.now();
    if (now - player.lastHurtAt < MOUNT_COMBAT_LOCK_SECONDS || now - player.lastAttackAt < MOUNT_COMBAT_LOCK_SECONDS) {
      return fail('You cannot call a mount in the middle of a fight.');
    }
    player.calling = MOUNT_CALL_SECONDS;
    this.events.area(player.body.x, player.body.z, { e: 'cast', id: player.id });
    return ok();
  }

  /** Gets off, or stops calling. */
  dismiss(player: Player): Result {
    player.dismount();
    return ok();
  }

  choose(player: Player, mount: MountId | null): Result {
    const p = player.progress;
    if (mount !== null && !p.mounts.includes(mount)) return fail(`You do not have a ${MOUNTS[mount].name}.`);
    p.mount = mount;
    player.touchProgress();
    if (player.riding) player.riding = mount;
    return ok();
  }

  /** Finishes calls that have run their time. */
  update(player: Player, dt: number): void {
    if (player.calling <= 0) return;
    player.calling = Math.max(0, player.calling - dt);
    if (player.calling > 0) return;
    const mount = player.progress.mount;
    if (!mount || player.dead) return;
    player.riding = mount;
    this.events.player(player.id, { e: 'toast', text: `Riding your ${MOUNTS[mount].name}. Press R to get off.` });
  }
}
