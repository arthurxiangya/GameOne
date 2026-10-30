import { clamp } from '../math/scalar';
import {
  CLASSES,
  DAMAGE_REDUCTION_CAP,
  capModifier,
  loadout,
  type ClassId,
  type Loadout,
  type Passive,
  type SpecId,
  type TalentPicks,
} from './classes';
import { gearStats, type Equipped, type GearStats } from './gear';
import { basePower, maxHpFor } from './stats';

/**
 * A hero's numbers: class, spec, talents and gear put together. The server's Player and the
 * client's panels both read them from here, so a tooltip always shows what the server uses.
 *
 *   Power  = (P₀(L) + weapon) × (1 + Power bonus)
 *   Health = (HP₀(L) × h + armour) × (1 + max-health group, capped at +50%)
 */

export interface HeroChoices {
  readonly cls: ClassId;
  readonly specs: Readonly<Partial<Record<ClassId, SpecId>>>;
  readonly talents: Readonly<Partial<Record<ClassId, TalentPicks>>>;
  readonly gear: Equipped;
}

export interface HeroStats {
  readonly loadout: Loadout;
  readonly gear: GearStats;
  /** Spec, talents, legendary and gear passives added together. */
  readonly passive: Passive;
  readonly power: number;
  readonly maxHp: number;
  readonly armor: number;
}

const PASSIVE_KEYS = ['damage', 'healing', 'maxHp', 'armor', 'crit', 'multiTarget', 'vsSlowed', 'haste', 'guard', 'onKill'] as const;

export function addPassives(a: Passive, b: Passive): Passive {
  const sum: Record<string, number> = {};
  for (const k of PASSIVE_KEYS) {
    const v = (a[k] ?? 0) + (b[k] ?? 0);
    if (v !== 0) sum[k] = v;
  }
  return sum as Passive;
}

/** `duel`: items count at no more than the matched level's item level. */
export function heroStats(h: HeroChoices, level: number, duel = false): HeroStats {
  const gear = gearStats(h.gear, duel ? level : null);
  const lo = loadout(h.cls, h, level, gear.legendary);
  const passive = addPassives(lo.passive, gear.passive);
  const def = CLASSES[h.cls];
  return {
    loadout: lo,
    gear,
    passive,
    power: (basePower(level) + gear.power) * (1 + gear.bonus.power),
    maxHp: Math.round((maxHpFor(level) * def.health + gear.health) * (1 + capModifier(passive.maxHp ?? 0))),
    armor: clamp(def.armor + (passive.armor ?? 0), 0, DAMAGE_REDUCTION_CAP),
  };
}
