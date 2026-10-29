import {
  EGG_DROP_CHANCE,
  EGG_HATCH_KILLS,
  MAX_EGGS,
  PETS,
  petForMonster,
  type MonsterType,
  type PetId,
  type RandomSource,
} from '@lanternwood/shared';
import type { Player } from '../entities/player';
import type { EventSink } from '../events';
import { fail, ok, type Result } from '../result';

/** Eggs, hatching, and choosing and naming pets. Pet XP lives with the hero's in ProgressionService. */
export class PetService {
  constructor(
    private readonly events: EventSink,
    private readonly rng: RandomSource,
  ) {}

  /** Whether a hero could take an egg for `pet` right now. */
  canTakeEgg(player: Player, pet: PetId): boolean {
    const p = player.progress;
    return !p.pets.some((x) => x.id === pet) && !p.eggs.some((e) => e.pet === pet) && p.eggs.length < MAX_EGGS;
  }

  giveEgg(player: Player, pet: PetId): Result {
    if (!this.canTakeEgg(player, pet)) {
      return fail(player.progress.eggs.length >= MAX_EGGS ? 'Your bag cannot hold another egg.' : `You already have a ${PETS[pet].name}.`);
    }
    player.progress.eggs.push({ pet, kills: 0 });
    player.touchProgress();
    this.events.player(player.id, { e: 'log', text: `You found a ${PETS[pet].name} egg! It hatches after ${EGG_HATCH_KILLS} more victories.`, c: 'loot' });
    return ok();
  }

  /** Every victory warms the eggs in your bag; a zone monster may drop its zone's egg. */
  onKill(player: Player, monster: MonsterType): void {
    const p = player.progress;
    for (const egg of [...p.eggs]) {
      egg.kills += 1;
      if (egg.kills >= EGG_HATCH_KILLS) this.hatch(player, egg.pet);
    }
    if (p.eggs.length > 0) player.touchProgress();
    const pet = petForMonster(monster);
    if (pet && this.canTakeEgg(player, pet) && this.rng.next() < EGG_DROP_CHANCE) this.giveEgg(player, pet);
  }

  choose(player: Player, pet: PetId | null): Result {
    const p = player.progress;
    if (pet !== null && !p.pets.some((x) => x.id === pet)) return fail(`You do not have a ${PETS[pet].name}.`);
    p.pet = pet;
    player.touchProgress();
    return ok();
  }

  rename(player: Player, pet: PetId, name: string): Result {
    const owned = player.progress.pets.find((x) => x.id === pet);
    if (!owned) return fail(`You do not have a ${PETS[pet].name}.`);
    owned.name = name;
    player.touchProgress();
    return ok();
  }

  /** Grants a pet outright (mode rewards). */
  grant(player: Player, pet: PetId): void {
    const p = player.progress;
    if (p.pets.some((x) => x.id === pet)) return;
    p.pets.push({ id: pet, name: PETS[pet].name, level: 1, xp: 0 });
    if (p.pet === null) p.pet = pet;
    player.touchProgress();
    this.events.player(player.id, { e: 'banner', title: PETS[pet].name, text: 'A new pet follows you' });
    this.events.player(player.id, { e: 'log', text: `${PETS[pet].name} joins you. Its bonus: more ${PETS[pet].describe}. Press P to see your pets.`, c: 'good' });
  }

  private hatch(player: Player, pet: PetId): void {
    const p = player.progress;
    p.eggs = p.eggs.filter((e) => e.pet !== pet);
    this.grant(player, pet);
  }
}
