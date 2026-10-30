import type { RandomSource } from '../math/random';
import type { Passive, SpecId, TalentDef, WeaponKind } from './classes';
import type { ClassSkillId, StatusDef } from './skills';

/**
 * Equipment as data. Six slots, five rarities, four affix stats on one diminishing curve, three
 * sets and one legendary per specialization. Every item fits every class: the weapon's main line
 * becomes whichever primary stat you use, so no drop is ever useless. Gear adds to Power, health
 * and the crit and haste stats talents already use, and the curve keeps the total to about a third.
 * See docs/adr/0015-gear-on-one-curve.md.
 */

export type GearSlot = 'weapon' | 'helm' | 'chest' | 'gloves' | 'boots' | 'charm';
export const GEAR_SLOTS: readonly GearSlot[] = ['weapon', 'helm', 'chest', 'gloves', 'boots', 'charm'];
/** The four slots with a Vigor main line, and the only ones sets use. */
export const ARMOUR_SLOTS: readonly GearSlot[] = ['helm', 'chest', 'gloves', 'boots'];

export const isGearSlot = (v: unknown): v is GearSlot => typeof v === 'string' && GEAR_SLOTS.includes(v as GearSlot);

export const SLOT_NAMES: Readonly<Record<GearSlot, string>> = {
  weapon: 'Weapon', helm: 'Helm', chest: 'Chest', gloves: 'Gloves', boots: 'Boots', charm: 'Charm',
};

/** What an item of each slot is called: weapons take the shape of your class's weapon. */
const BASE_NAMES: Readonly<Record<Exclude<GearSlot, 'weapon'>, string>> = {
  helm: 'Helm', chest: 'Jerkin', gloves: 'Gloves', boots: 'Boots', charm: 'Charm',
};
const WEAPON_NAMES: Readonly<Record<WeaponKind, string>> = { shield: 'Shield', staff: 'Staff', bow: 'Bow', sword: 'Blade', bell: 'Bell' };

export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
export const RARITIES: readonly Rarity[] = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
export const isRarity = (v: unknown): v is Rarity => typeof v === 'string' && RARITIES.includes(v as Rarity);

export interface RarityDef {
  readonly name: string;
  /** Affixes on an item of this rarity (a charm gets one more; set pieces have 2). */
  readonly affixes: number;
  /** Embers from salvaging it. */
  readonly embers: number;
  readonly color: string;
}

export const RARITY: Readonly<Record<Rarity, RarityDef>> = {
  common: { name: 'Common', affixes: 0, embers: 1, color: '#d8d2c2' },
  uncommon: { name: 'Uncommon', affixes: 1, embers: 2, color: '#72d05f' },
  rare: { name: 'Rare', affixes: 2, embers: 4, color: '#5aa6f0' },
  epic: { name: 'Epic', affixes: 3, embers: 8, color: '#c27cf2' },
  legendary: { name: 'Legendary', affixes: 2, embers: 16, color: '#f2a83c' },
};
/** Set pieces pay for their bonuses with one affix. */
export const SET_PIECE_AFFIXES = 2;

export type AffixStat = 'power' | 'crit' | 'haste' | 'vigor';
export const AFFIX_STATS: readonly AffixStat[] = ['power', 'crit', 'haste', 'vigor'];
export const isAffixStat = (v: unknown): v is AffixStat => typeof v === 'string' && AFFIX_STATS.includes(v as AffixStat);

export interface AffixDef {
  readonly name: string;
  /** The most this stat can ever add, however much rating you stack. */
  readonly cap: number;
  readonly text: string;
  /** "Helm of Vigor". */
  readonly suffix: string;
}

export const AFFIXES: Readonly<Record<AffixStat, AffixDef>> = {
  power: { name: 'Power', cap: 0.3, text: 'more Power', suffix: 'Might' },
  crit: { name: 'Crit', cap: 0.2, text: 'more crit chance', suffix: 'Precision' },
  haste: { name: 'Haste', cap: 0.2, text: 'faster cooldowns and resource', suffix: 'Swiftness' },
  vigor: { name: 'Vigor', cap: 0.3, text: 'more max health', suffix: 'Vigor' },
};

/** Rating at which a stat gives half its cap. Every affix stat shares this curve. */
export const AFFIX_HALF_RATING = 60;
/** One affix is worth this much rating per item level. */
export const AFFIX_RATING_PER_ILVL = 0.1;
/** The weapon's main line: Power (as your primary stat) per item level. */
export const WEAPON_POWER_PER_ILVL = 0.2;
/** Each armour piece's main line: health per item level. */
export const ARMOUR_HEALTH_PER_ILVL = 0.4;
/** Items drop at this many item levels per level of what dropped them. */
export const ILVL_PER_LEVEL = 5;
/** Elite sources add one step, raid sources two. */
export const ILVL_PER_TIER = 5;
/** No item ever goes above this. */
export const ILVL_CEILING = 110;
export const BAG_SIZE = 24;

/** 0 normal (monsters, Oda), 1 elite (bosses), 2 raid (the realm's biggest fights). */
export type SourceTier = 0 | 1 | 2;
export const TIER_NAMES: readonly string[] = ['Normal', 'Elite', 'Raid'];

/** Bonus from `rating` in one stat: cap × R / (R + 60). Stacking one stat runs into its cap, so mixing wins. */
export const affixBonus = (stat: AffixStat, rating: number): number =>
  rating <= 0 ? 0 : (AFFIXES[stat].cap * rating) / (rating + AFFIX_HALF_RATING);

export const affixRating = (ilvl: number): number => ilvl * AFFIX_RATING_PER_ILVL;

/** The highest item level an upgrade can reach: the source's ceiling, and five per level of the hero. */
export const upgradeCeiling = (tier: SourceTier, level: number): number =>
  Math.min(ILVL_CEILING - (2 - tier) * ILVL_PER_TIER, ILVL_PER_LEVEL * level + ILVL_PER_TIER * tier);

/** The item level a source of this level drops for a hero of that level. */
export const dropIlvl = (sourceLevel: number, heroLevel: number, tier: SourceTier): number =>
  Math.min(ILVL_CEILING, ILVL_PER_LEVEL * Math.max(1, Math.min(sourceLevel, heroLevel)) + ILVL_PER_TIER * tier);

// ---------------------------------------------------------------- items

export type SetId = 'frostward' | 'emberfall' | 'bellsong';
export type LegendaryId =
  | 'frostHeartAegis' | 'quakebornGreaves'
  | 'dawnbringerCenser' | 'cinderLantern'
  | 'pipsLuckyQuiver' | 'tanglewoodTreads'
  | 'twinflameHilt' | 'ashenMantle'
  | 'clarion' | 'stillwaterChime';

/** One piece of gear. Items never change in place: an upgrade or reforge replaces the object. */
export interface Item {
  /** Unique among this hero's items. */
  readonly id: number;
  readonly slot: GearSlot;
  readonly rarity: Rarity;
  readonly ilvl: number;
  readonly tier: SourceTier;
  /** Each affix is worth `0.1 × ilvl` rating in its stat. The same stat may appear twice. */
  readonly affixes: readonly AffixStat[];
  /** The affix that has been reforged, which is then the only one that can be; -1 before any. */
  readonly reforged: number;
  readonly set: SetId | null;
  readonly legendary: LegendaryId | null;
}

/** What a hero wears. */
export type Equipped = Readonly<Partial<Record<GearSlot, Item>>>;

/** Affixes an item of this slot, rarity and kind carries. */
export function affixCount(slot: GearSlot, rarity: Rarity, set: SetId | null): number {
  const base = set ? SET_PIECE_AFFIXES : RARITY[rarity].affixes;
  return base + (slot === 'charm' ? 1 : 0);
}

const pick = <T>(rng: RandomSource, list: readonly T[]): T => list[Math.min(list.length - 1, Math.floor(rng.next() * list.length))]!;

/** Rolls a new item. Affix stats are uniform and independent. */
export function rollItem(
  rng: RandomSource,
  id: number,
  o: { readonly ilvl: number; readonly tier: SourceTier; readonly rarity: Rarity; readonly slot?: GearSlot; readonly set?: SetId | null; readonly legendary?: LegendaryId | null },
): Item {
  const legendary = o.legendary ?? null;
  const slot = legendary ? LEGENDARIES[legendary].slot : (o.slot ?? pick(rng, o.set ? ARMOUR_SLOTS : GEAR_SLOTS));
  const set = o.set && ARMOUR_SLOTS.includes(slot) ? o.set : null;
  const rarity: Rarity = legendary ? 'legendary' : set ? 'epic' : o.rarity;
  const affixes = Array.from({ length: affixCount(slot, rarity, set) }, () => pick(rng, AFFIX_STATS));
  return { id, slot, rarity, ilvl: Math.min(ILVL_CEILING, o.ilvl), tier: o.tier, affixes, reforged: -1, set, legendary };
}

/** "Rare Helm of Vigor", "Frostward Gloves", "Pip’s Lucky Quiver". */
export function itemName(item: Item, weapon: WeaponKind): string {
  if (item.legendary) return LEGENDARIES[item.legendary].name;
  const base = item.slot === 'weapon' ? WEAPON_NAMES[weapon] : BASE_NAMES[item.slot];
  if (item.set) return `${SETS[item.set].name} ${base}`;
  if (item.affixes.length === 0) return base;
  const counts = new Map<AffixStat, number>();
  for (const a of item.affixes) counts.set(a, (counts.get(a) ?? 0) + 1);
  const top = [...counts].reduce((a, b) => (b[1] > a[1] ? b : a))[0];
  return `${base} of ${AFFIXES[top].suffix}`;
}

/** The main line, in words: "+20 Might", "+40 health", or nothing for a charm. */
export function mainLine(item: Item, primary: string): string | null {
  if (item.slot === 'weapon') return `+${round1(item.ilvl * WEAPON_POWER_PER_ILVL)} ${primary}`;
  if (item.slot === 'charm') return null;
  return `+${round1(item.ilvl * ARMOUR_HEALTH_PER_ILVL)} health`;
}

export const round1 = (v: number): number => Math.round(v * 10) / 10;

// ---------------------------------------------------------------- sets

/** A set's four-piece bonus: one engine hook each. */
export type GearProc =
  /** Dropping below `below` of max health shields you for `k` × Power for `seconds`, once every `every` seconds. */
  | { readonly kind: 'lowHealthShield'; readonly below: number; readonly k: number; readonly seconds: number; readonly every: number }
  /** Your critical hits put this status on what they hit. */
  | { readonly kind: 'critStatus'; readonly status: StatusDef }
  /** Your fourth skill also gives this status to every ally within `radius`. */
  | { readonly kind: 'signatureStatus'; readonly radius: number; readonly status: StatusDef };

export interface SetDef {
  readonly id: SetId;
  readonly name: string;
  /** Where it drops, in words. */
  readonly source: string;
  readonly two: { readonly text: string; readonly passive: Passive };
  readonly four: { readonly text: string; readonly proc: GearProc };
}

export const SETS: Readonly<Record<SetId, SetDef>> = {
  frostward: {
    id: 'frostward', name: 'Frostward', source: 'the Warden of the Frost Heart',
    two: { text: '+8% max health.', passive: { maxHp: 0.08 } },
    four: {
      text: 'Dropping below 40% health shields you for 2 × Power for 8 s (once every 30 s).',
      proc: { kind: 'lowHealthShield', below: 0.4, k: 2, seconds: 8, every: 30 },
    },
  },
  emberfall: {
    id: 'emberfall', name: 'Emberfall', source: 'the Rift Lord',
    two: { text: '+5% damage.', passive: { damage: 0.05 } },
    four: {
      text: 'Your critical hits burn for 0.3 × Power over 3 s.',
      proc: { kind: 'critStatus', status: { id: 'emberfall', name: 'Emberfall', seconds: 3, dot: 0.3 } },
    },
  },
  bellsong: {
    id: 'bellsong', name: 'Bellsong', source: 'the Gloom Knight on Lantern Night',
    two: { text: '+8% healing done.', passive: { healing: 0.08 } },
    four: {
      text: 'Your fourth skill also gives allies within 10 blocks 8% more damage for 8 s.',
      proc: { kind: 'signatureStatus', radius: 10, status: { id: 'bellsong', name: 'Bellsong', seconds: 8, damageDealt: 0.08 } },
    },
  },
};
export const SET_IDS = Object.keys(SETS) as readonly SetId[];

// ---------------------------------------------------------------- legendaries

/**
 * A legendary is a talent carried by an item: the same composable change and passive, active
 * only for its own specialization. Only one can be worn, so it picks a play style rather than
 * stacking power, and its effect is paid for with one fewer affix than an epic.
 */
export interface LegendaryDef extends TalentDef {
  readonly id: LegendaryId;
  readonly spec: SpecId;
  readonly slot: GearSlot;
  /** Every `every`-th use of `skill` also casts `cast` for free at the same target. */
  readonly echo?: { readonly skill: ClassSkillId; readonly every: number; readonly cast: ClassSkillId };
}

export const LEGENDARIES: Readonly<Record<LegendaryId, LegendaryDef>> = {
  frostHeartAegis: {
    id: 'frostHeartAegis', name: 'Frost Heart Aegis', spec: 'bulwark', slot: 'chest',
    text: 'Taunt also raises the Frost Heart for 4 s: attackers take 40% of each blow back.',
    change: { skill: 'taunt', effects: [{ kind: 'status', to: 'self', status: { id: 'aegis', name: 'Frost Heart', seconds: 4, reflect: 0.4 } }] },
  },
  quakebornGreaves: {
    id: 'quakebornGreaves', name: 'Quakeborn Greaves', spec: 'vanguard', slot: 'boots',
    text: 'Ground Slam costs 10 less Resolve and heals you for 12% of the damage it deals.',
    change: { skill: 'groundSlam', cost: -10, leech: 0.12 },
  },
  dawnbringerCenser: {
    id: 'dawnbringerCenser', name: 'Dawnbringer Censer', spec: 'dawnkeeper', slot: 'weapon',
    text: 'Radiance also heals everyone it touches for 1.2 × Power more over 6 s.',
    change: { skill: 'radiance', effects: [{ kind: 'status', to: 'allies', status: { id: 'dawnbringer', name: 'Dawnbringer', seconds: 6, hot: 1.2 } }] },
  },
  cinderLantern: {
    id: 'cinderLantern', name: 'Cinder Lantern', spec: 'emberpriest', slot: 'charm',
    text: 'Sunbolt leaves its target smouldering for 0.5 × Power over 3 s.',
    change: { skill: 'sunbolt', effects: [{ kind: 'status', to: 'enemies', status: { id: 'cinders', name: 'Cinders', seconds: 3, dot: 0.5 } }] },
  },
  pipsLuckyQuiver: {
    id: 'pipsLuckyQuiver', name: 'Pip’s Lucky Quiver', spec: 'sharpshooter', slot: 'charm',
    text: 'Every fourth Aimed Shot looses a second one, free.',
    echo: { skill: 'aimedShot', every: 4, cast: 'aimedShot' },
  },
  tanglewoodTreads: {
    id: 'tanglewoodTreads', name: 'Tanglewood Treads', spec: 'trapper', slot: 'boots',
    text: 'Pinning Shot’s slow reaches everything within 4 blocks of its target.',
    // Splash 0: the area carries the slow, not the damage.
    change: { skill: 'pinningShot', radius: 4, splash: 0 },
  },
  twinflameHilt: {
    id: 'twinflameHilt', name: 'Twinflame Hilt', spec: 'duelist', slot: 'weapon',
    text: 'Searing Edge heals you for 30% of the damage its strike deals.',
    change: { skill: 'searingEdge', leech: 0.3 },
  },
  ashenMantle: {
    id: 'ashenMantle', name: 'Ashen Mantle', spec: 'wildfire', slot: 'chest',
    text: 'Searing Edge’s fire spreads: everything within 3 blocks of the target takes 10% of the strike and the whole burn.',
    change: { skill: 'searingEdge', radius: 3, splash: 0.1 },
  },
  clarion: {
    id: 'clarion', name: 'Clarion of the Night Bell', spec: 'warbell', slot: 'weapon',
    text: 'Peal also makes enemies within its reach take 10% more damage for 10 s.',
    change: { skill: 'peal', effects: [{ kind: 'status', to: 'enemies', status: { id: 'clarion', name: 'Clarion', seconds: 10, damageTaken: 0.1 } }] },
  },
  stillwaterChime: {
    id: 'stillwaterChime', name: 'Stillwater Chime', spec: 'stillwater', slot: 'charm',
    text: 'Discord reaches everything within 5 blocks of its target.',
    change: { skill: 'discord', radius: 5, splash: 1 },
  },
};
export const LEGENDARY_IDS = Object.keys(LEGENDARIES) as readonly LegendaryId[];
export const isLegendaryId = (v: unknown): v is LegendaryId => typeof v === 'string' && v in LEGENDARIES;
export const legendaryFor = (spec: SpecId): LegendaryDef | null => LEGENDARY_IDS.map((id) => LEGENDARIES[id]).find((l) => l.spec === spec) ?? null;

// ---------------------------------------------------------------- what gear adds up to

export interface GearStats {
  /** Flat Power from the weapon's main line. */
  readonly power: number;
  /** Flat health from the armour's main lines. */
  readonly health: number;
  readonly rating: Readonly<Record<AffixStat, number>>;
  /** Each stat's bonus after the curve: power multiplies Power, vigor max health. */
  readonly bonus: Readonly<Record<AffixStat, number>>;
  readonly sets: readonly { readonly set: SetDef; readonly pieces: number }[];
  readonly procs: readonly GearProc[];
  /** Crit, haste, max health and the two-piece bonuses, to add to the class passive. */
  readonly passive: Passive;
  /** The legendary worn, whether or not its spec is active. */
  readonly legendary: LegendaryDef | null;
}

const zero = (): Record<AffixStat, number> => ({ power: 0, crit: 0, haste: 0, vigor: 0 });
const cache = new WeakMap<Equipped, GearStats>();

/**
 * Adds up what a hero wears. `maxIlvl` (a duel's matched level) counts each item at no more than
 * five per level plus its tier, so gear from higher levels doesn't decide a level-matched fight.
 */
export function gearStats(gear: Equipped, maxLevel: number | null = null): GearStats {
  if (maxLevel === null) {
    const hit = cache.get(gear);
    if (hit) return hit;
  }
  let power = 0;
  let health = 0;
  const rating = zero();
  const pieces = new Map<SetId, number>();
  let legendary: LegendaryDef | null = null;
  for (const slot of GEAR_SLOTS) {
    const item = gear[slot];
    if (!item) continue;
    const ilvl = maxLevel === null ? item.ilvl : Math.min(item.ilvl, ILVL_PER_LEVEL * maxLevel + ILVL_PER_TIER * item.tier);
    if (slot === 'weapon') power += ilvl * WEAPON_POWER_PER_ILVL;
    else if (slot !== 'charm') health += ilvl * ARMOUR_HEALTH_PER_ILVL;
    for (const a of item.affixes) rating[a] += affixRating(ilvl);
    if (item.set) pieces.set(item.set, (pieces.get(item.set) ?? 0) + 1);
    if (item.legendary && !legendary) legendary = LEGENDARIES[item.legendary];
  }
  const bonus = zero();
  for (const s of AFFIX_STATS) bonus[s] = affixBonus(s, rating[s]);
  const sets = [...pieces].map(([id, n]) => ({ set: SETS[id], pieces: n }));
  const extra: Record<string, number> = { crit: bonus.crit, haste: bonus.haste, maxHp: bonus.vigor };
  const procs: GearProc[] = [];
  for (const { set, pieces: n } of sets) {
    if (n >= 2) for (const [k, v] of Object.entries(set.two.passive)) extra[k] = (extra[k] ?? 0) + (v as number);
    if (n >= 4) procs.push(set.four.proc);
  }
  const stats: GearStats = { power, health, rating, bonus, sets, procs, passive: extra as Passive, legendary };
  if (maxLevel === null) cache.set(gear, stats);
  return stats;
}

/** Can this be worn alongside the rest? Only one legendary at a time. */
export function canWear(gear: Equipped, item: Item): string | null {
  if (!item.legendary) return null;
  const other = GEAR_SLOTS.find((s) => s !== item.slot && gear[s]?.legendary);
  return other ? 'You can wear only one legendary at a time.' : null;
}

// ---------------------------------------------------------------- drops and Smith Oda

export interface DropTable {
  /** Chance of an item per kill. */
  readonly chance: number;
  /** Rarity weights, summing to 1. */
  readonly rarity: readonly (readonly [Rarity, number])[];
  readonly tier: SourceTier;
  /** Epic armour from this source belongs to the set this often. */
  readonly set?: { readonly id: SetId; readonly share: number };
  /** Chance of a legendary for your specialization as well, if you have one. */
  readonly legendary?: number;
}

/** Any regular monster, for the hero who kills it. */
export const MONSTER_DROPS: DropTable = { chance: 0.06, rarity: [['common', 0.6], ['uncommon', 0.35], ['rare', 0.05]], tier: 0 };

/**
 * Bosses drop for every hero near them when they fall. Until dungeons open, the Lantern Night
 * siege and the Rift Lord stand in for raid and endless sources.
 */
export const BOSS_DROPS: Readonly<Record<'warden' | 'gloomknight' | 'riftlord', DropTable>> = {
  warden: { chance: 1, rarity: [['rare', 0.6], ['epic', 0.4]], tier: 1, set: { id: 'frostward', share: 0.5 } },
  riftlord: { chance: 1, rarity: [['rare', 0.6], ['epic', 0.4]], tier: 1, set: { id: 'emberfall', share: 0.5 }, legendary: 0.08 },
  gloomknight: { chance: 1, rarity: [['rare', 0.5], ['epic', 0.5]], tier: 2, set: { id: 'bellsong', share: 0.5 }, legendary: 0.08 },
};

export function rollRarity(rng: RandomSource, table: DropTable): Rarity {
  let r = rng.next();
  for (const [rarity, weight] of table.rarity) {
    if (r < weight) return rarity;
    r -= weight;
  }
  return table.rarity[table.rarity.length - 1]![0];
}

export const FORGE = {
  reforge: { embers: 10, marks: 1 },
  upgrade: { embers: 20, ilvl: 5 },
  craft: { embers: 40, marks: 3 },
} as const;

/** Oda's plain weapon at your level, for gold. */
export const weaponPrice = (level: number): number => 20 + 10 * level;

/** Legacy weapon tiers (0–5) become a weapon of item level 20 × tier: the same 4 × tier Power. */
export const LEGACY_ILVL_PER_TIER = 20;
