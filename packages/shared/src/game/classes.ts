import { clamp } from '../math/scalar';
import { TONIC, skill, type ClassSkillId, type SkillDef, type SkillId, type StatusDef } from './skills';
import { attackFor, maxHpFor } from './stats';

/**
 * Classes as data. A class sets a hero's health multiplier, armour, threat, resource and four
 * skills; a specialization (from level 10) adds one passive and changes one skill. The server
 * runs these through one skill engine, the client builds its skill bar and class panel from
 * them, and the balance test checks every class and spec against the targets below.
 * See docs/adr/0013-classes-as-data.md.
 */

export type ClassId = 'warden' | 'lightkeeper' | 'ranger' | 'emberblade' | 'chimer';
export type SpecId = 'bulwark' | 'vanguard' | 'dawnkeeper' | 'emberpriest' | 'sharpshooter' | 'trapper' | 'duelist' | 'wildfire' | 'warbell' | 'stillwater';
export type Role = 'tank' | 'healer' | 'damage' | 'support';
export type PrimaryStat = 'Might' | 'Finesse' | 'Spirit';
export type ResourceKind = 'resolve' | 'mana' | 'focus' | 'heat';
export type WeaponKind = 'shield' | 'staff' | 'bow' | 'sword' | 'bell';

export interface ResourceDef {
  readonly kind: ResourceKind;
  /** Pool at level 1, and how much it grows per level. */
  readonly base: number;
  readonly perLevel: number;
  readonly startFull: boolean;
  /** Per second; negative drains. */
  readonly regenInCombat: number;
  readonly regenOutOfCombat: number;
  /** Gained each time a monster or duel opponent hits you. */
  readonly perHitTaken: number;
}

export const RESOURCES: Readonly<Record<ResourceKind, { readonly name: string; readonly color: string }>> = {
  resolve: { name: 'Resolve', color: '#c9a35a' },
  mana: { name: 'Mana', color: '#4f8ee8' },
  focus: { name: 'Focus', color: '#7cc46a' },
  heat: { name: 'Heat', color: '#ef6a2b' },
};

/** Always-on bonuses from a spec. Every field adds; damage and healing bonuses share the +50% cap. */
export interface Passive {
  readonly damage?: number;
  readonly healing?: number;
  readonly maxHp?: number;
  /** Added to the class's armour (negative lowers it). */
  readonly armor?: number;
  readonly crit?: number;
  /** Extra damage when a skill hits two or more enemies. */
  readonly multiTarget?: number;
  /** Extra damage against slowed enemies. */
  readonly vsSlowed?: number;
}

export interface SpecDef {
  readonly id: SpecId;
  readonly name: string;
  /** What it leans toward, in a word or two. */
  readonly leaning: string;
  /** The passive, in words. */
  readonly passiveText: string;
  /** The skill change, in words. */
  readonly changeText: string;
  readonly passive: Passive;
  /** Replaces fields of the class's skills. */
  readonly patch: Partial<Record<ClassSkillId, Partial<Omit<SkillDef, 'id'>>>>;
}

/** How the balance test (and, one day, companions) plays a class: the first usable step wins. */
export interface RotationStep {
  readonly skill: SkillId;
  /** `hurt`: below 70% health. `pack`: two or more enemies within 6 blocks. */
  readonly when: 'always' | 'hurt' | 'pack';
}

export interface ClassDef {
  readonly id: ClassId;
  readonly name: string;
  readonly role: Role;
  readonly fantasy: string;
  readonly primary: PrimaryStat;
  readonly weapon: WeaponKind;
  /** Accent colour for the class in the UI. */
  readonly color: string;
  /** Multiplier on base health. */
  readonly health: number;
  /** Share of incoming damage ignored. */
  readonly armor: number;
  /** Multiplier on threat from damage. */
  readonly threat: number;
  readonly resource: ResourceDef;
  readonly strengths: string;
  readonly weaknesses: string;
  /** Exactly four, in skill-bar order. */
  readonly skills: readonly SkillDef[];
  readonly specs: readonly [SpecDef, SpecDef];
  readonly rotation: readonly RotationStep[];
  /** Designed sustained single-target output, in Power per second before crits. */
  readonly targetOutput: number;
}

/** Specializations open at this level. */
export const SPEC_LEVEL = 10;
/** No damage or healing modifier group may add more than this. */
export const MODIFIER_CAP = 0.5;
/** All damage reduction together (armour and statuses) can't pass this. */
export const DAMAGE_REDUCTION_CAP = 0.6;
/** Seconds since your last hit dealt or taken before you count as out of combat. */
export const OUT_OF_COMBAT_SECONDS = 5;
/** You can change class within this many blocks of the Emberhold fountain. */
export const CLASS_CHANGE_RADIUS = 40;

const MELEE = 2.6;

const slowed = (id: string, name: string, slow: number, seconds: number): StatusDef => ({ id, name, slow, seconds });

// ---------------------------------------------------------------- the five classes

const WARDEN: ClassDef = {
  id: 'warden',
  name: 'Warden',
  role: 'tank',
  fantasy: 'Emberhold’s shield-bearer, who plants their feet and makes the Gloom look at them.',
  primary: 'Might',
  weapon: 'shield',
  color: '#c9a35a',
  health: 1.35,
  armor: 0.25,
  threat: 3,
  resource: { kind: 'resolve', base: 100, perLevel: 0, startFull: false, regenInCombat: 0, regenOutOfCombat: -8, perHitTaken: 6 },
  strengths: 'Holds packs and bosses; takes a quarter less damage; triple threat.',
  weaknesses: 'Lowest melee damage; short reach.',
  skills: [
    skill({
      id: 'shieldBash', name: 'Shield Bash', icon: 'shield', cooldown: 0.9, gain: 5, target: 'enemy', delivery: 'melee', range: MELEE,
      effects: [{ kind: 'damage', k: 0.95 }], color: 0xffd27a, text: 'Bash one target in reach for {d}. Builds 5 Resolve.',
    }),
    skill({
      id: 'taunt', name: 'Taunting Shout', icon: 'shout', cooldown: 8, gain: 10, target: 'around', radius: 7,
      effects: [{ kind: 'taunt', seconds: 4 }, { kind: 'damage', k: 0.4 }], color: 0xffd27a,
      text: 'Monsters within {r} attack you for 4 s and take {d}. Builds 10 Resolve.',
    }),
    skill({
      id: 'shieldWall', name: 'Shield Wall', icon: 'wall', unlockLevel: 2, cooldown: 12, cost: 30, target: 'self',
      effects: [
        { kind: 'status', to: 'self', status: { id: 'shieldWall', name: 'Shield Wall', seconds: 5, damageTaken: -0.4 } },
        { kind: 'heal', to: 'self', maxHp: 0.1 },
      ],
      text: 'Take 40% less damage for 5 s and heal 10% of your health.',
    }),
    skill({
      id: 'groundSlam', name: 'Ground Slam', icon: 'slam', unlockLevel: 4, cooldown: 8, cost: 25, target: 'around', radius: 4.5,
      effects: [{ kind: 'damage', k: 1.4 }, { kind: 'status', to: 'enemies', status: slowed('slammed', 'Slowed', 0.4, 3) }],
      color: 0xe8c47a, text: 'Hit everything within {r} for {d} and slow it 40% for 3 s.',
    }),
  ],
  specs: [
    {
      id: 'bulwark', name: 'Bulwark', leaning: 'Protection', passive: { maxHp: 0.1, armor: 0.05 },
      passiveText: '+10% max health; armour 25% → 30%.', changeText: 'Shield Wall also gives allies within 8 blocks 20% less damage taken.',
      patch: {
        shieldWall: {
          target: 'around', radius: 8,
          effects: [
            { kind: 'status', to: 'self', status: { id: 'shieldWall', name: 'Shield Wall', seconds: 5, damageTaken: -0.4 } },
            { kind: 'heal', to: 'self', maxHp: 0.1 },
            { kind: 'status', to: 'others', status: { id: 'bulwark', name: 'Bulwark', seconds: 5, damageTaken: -0.2 } },
          ],
          text: 'Take 40% less damage for 5 s and heal 10% of your health. Allies within {r} take 20% less.',
        },
      },
    },
    {
      id: 'vanguard', name: 'Vanguard', leaning: 'Damage', passive: { damage: 0.2, armor: -0.07 },
      passiveText: '+20% damage; armour 25% → 18%.', changeText: 'Ground Slam cooldown 8 → 6 s.',
      patch: { groundSlam: { cooldown: 6 } },
    },
  ],
  rotation: [
    { skill: 'shieldWall', when: 'hurt' },
    { skill: 'groundSlam', when: 'always' },
    { skill: 'taunt', when: 'always' },
    { skill: 'shieldBash', when: 'always' },
  ],
  targetOutput: 1.3,
};

const LIGHTKEEPER: ClassDef = {
  id: 'lightkeeper',
  name: 'Lightkeeper',
  role: 'healer',
  fantasy: 'A lantern priest whose light mends friends and burns the Gloom.',
  primary: 'Spirit',
  weapon: 'staff',
  color: '#f2d36b',
  health: 1,
  armor: 0.05,
  threat: 1,
  resource: { kind: 'mana', base: 60, perLevel: 10, startFull: true, regenInCombat: 2.5, regenOutOfCombat: 6, perHitTaken: 0 },
  strengths: 'Keeps a group alive; endless sustain alone.',
  weaknesses: 'Slowest kills; runs dry in long fights.',
  skills: [
    skill({
      id: 'sunbolt', name: 'Sunbolt', icon: 'sun', cooldown: 1.4, target: 'enemy', delivery: 'projectile', range: 17,
      effects: [{ kind: 'damage', k: 1.3 }], color: 0xfff0a0, text: 'Hurl light for {d} at up to 17 blocks.',
    }),
    skill({
      id: 'mend', name: 'Mend', icon: 'cross', cooldown: 2.5, cost: 12, target: 'ally', range: 20,
      effects: [{ kind: 'heal', to: 'allies', k: 2.5 }], text: 'Heal yourself or the hero you target for {h}.',
    }),
    skill({
      id: 'radiance', name: 'Radiance', icon: 'burst', unlockLevel: 2, cooldown: 8, cost: 20, target: 'around', radius: 8,
      effects: [{ kind: 'heal', to: 'allies', k: 1.2 }, { kind: 'damage', k: 1 }], color: 0xfff0a0,
      text: 'Heal allies within {r} for {h} and burn enemies there for {d}.',
    }),
    skill({
      id: 'ward', name: 'Lantern Ward', icon: 'ward', unlockLevel: 4, cooldown: 10, cost: 18, target: 'ally', range: 20,
      effects: [{ kind: 'shield', to: 'allies', k: 3, seconds: 8 }], text: 'Shield yourself or your target: absorbs {s} for 8 s.',
    }),
  ],
  specs: [
    {
      id: 'dawnkeeper', name: 'Dawnkeeper', leaning: 'Healing', passive: { healing: 0.3 },
      passiveText: '+30% healing.', changeText: 'Radiance reaches 12 blocks and heals 1.6 P.',
      patch: { radiance: { radius: 12, effects: [{ kind: 'heal', to: 'allies', k: 1.6 }, { kind: 'damage', k: 1 }] } },
    },
    {
      id: 'emberpriest', name: 'Emberpriest', leaning: 'Damage', passive: { damage: 0.2, healing: -0.2 },
      passiveText: '+20% damage, −20% healing.', changeText: 'Sunbolt heals you for 15% of its damage.',
      patch: { sunbolt: { leech: 0.15, text: 'Hurl light for {d} at up to 17 blocks, healing you for 15% of it.' } },
    },
  ],
  rotation: [
    { skill: 'mend', when: 'hurt' },
    { skill: 'ward', when: 'hurt' },
    { skill: 'radiance', when: 'always' },
    { skill: 'sunbolt', when: 'always' },
  ],
  targetOutput: 1.05,
};

const RANGER: ClassDef = {
  id: 'ranger',
  name: 'Ranger',
  role: 'damage',
  fantasy: 'A scout who never lets a boar reach them.',
  primary: 'Finesse',
  weapon: 'bow',
  color: '#7cc46a',
  health: 0.95,
  armor: 0.05,
  threat: 1,
  resource: { kind: 'focus', base: 100, perLevel: 0, startFull: true, regenInCombat: 12, regenOutOfCombat: 12, perHitTaken: 0 },
  strengths: 'Range, single-target burst, kiting with slows.',
  weaknesses: 'Fragile in melee; no self-heal.',
  skills: [
    skill({
      id: 'quickShot', name: 'Quick Shot', icon: 'arrow', cooldown: 0.9, target: 'enemy', delivery: 'projectile', range: 18,
      effects: [{ kind: 'damage', k: 0.85 }], color: 0xd8f0a0, text: 'Loose an arrow for {d} at up to 18 blocks.',
    }),
    skill({
      id: 'aimedShot', name: 'Aimed Shot', icon: 'aim', cooldown: 3, cost: 30, target: 'enemy', delivery: 'projectile', range: 22,
      effects: [{ kind: 'damage', k: 2.2 }], color: 0xf4ffd0, text: 'A careful shot for {d} at up to 22 blocks.',
    }),
    skill({
      id: 'pinningShot', name: 'Pinning Shot', icon: 'pin', unlockLevel: 2, cooldown: 8, cost: 20, target: 'enemy', delivery: 'projectile', range: 18,
      effects: [{ kind: 'damage', k: 0.8 }, { kind: 'status', to: 'enemies', status: slowed('pinned', 'Pinned', 0.5, 4) }],
      color: 0xb8e08a, text: 'Hit for {d} and slow the target 50% for 4 s.',
    }),
    skill({
      id: 'volley', name: 'Volley', icon: 'volley', unlockLevel: 4, cooldown: 10, cost: 40, target: 'enemy', delivery: 'projectile', range: 18, radius: 4,
      effects: [{ kind: 'damage', k: 1 }], color: 0xd8f0a0, text: 'Rain arrows on the target: {d} to everything within {r} of it.',
    }),
  ],
  specs: [
    {
      id: 'sharpshooter', name: 'Sharpshooter', leaning: 'One target', passive: { crit: 0.1 },
      passiveText: '+10% crit chance.', changeText: 'Aimed Shot +30% damage.',
      patch: { aimedShot: { effects: [{ kind: 'damage', k: 2.86 }] } },
    },
    {
      id: 'trapper', name: 'Trapper', leaning: 'Packs and control', passive: { vsSlowed: 0.15 },
      passiveText: 'Slowed enemies take 15% more damage from you.', changeText: 'Volley slows 40% for 3 s, costs 30 Focus and recovers in 7 s.',
      patch: {
        volley: {
          cost: 30, cooldown: 7,
          effects: [{ kind: 'damage', k: 1 }, { kind: 'status', to: 'enemies', status: slowed('snared', 'Snared', 0.4, 3) }],
          text: 'Rain arrows on the target: {d} to everything within {r} of it, slowed 40% for 3 s.',
        },
      },
    },
  ],
  rotation: [
    { skill: 'aimedShot', when: 'always' },
    { skill: 'pinningShot', when: 'always' },
    { skill: 'volley', when: 'pack' },
    { skill: 'quickShot', when: 'always' },
  ],
  targetOutput: 1.75,
};

const EMBERBLADE: ClassDef = {
  id: 'emberblade',
  name: 'Emberblade',
  role: 'damage',
  fantasy: 'A fire-forged swordfighter who gets hotter as the fight goes on.',
  primary: 'Might',
  weapon: 'sword',
  color: '#ef6a2b',
  health: 1.1,
  armor: 0.12,
  threat: 1,
  resource: { kind: 'heat', base: 100, perLevel: 0, startFull: false, regenInCombat: 0, regenOutOfCombat: -10, perHitTaken: 0 },
  strengths: 'Highest sustained damage; strong in packs.',
  weaknesses: 'Starts every fight cold; must stand in melee.',
  skills: [
    skill({
      id: 'slash', name: 'Slash', icon: 'sword', cooldown: 0.75, gain: 12, target: 'enemy', delivery: 'melee', range: MELEE,
      effects: [{ kind: 'damage', k: 0.85 }], color: 0xff8a2a, text: 'Cut one target in reach for {d}. Builds 12 Heat.',
    }),
    skill({
      id: 'searingEdge', name: 'Searing Edge', icon: 'flame', cooldown: 4, gain: 10, target: 'enemy', delivery: 'melee', range: MELEE,
      effects: [{ kind: 'damage', k: 1.4 }, { kind: 'status', to: 'enemies', status: { id: 'burn', name: 'Burning', seconds: 4, dot: 0.6 } }],
      color: 0xff8a2a, text: 'Hit for {d}, then burn for {o} over 4 s. Builds 10 Heat.',
    }),
    skill({
      id: 'kindle', name: 'Kindle', icon: 'heart', unlockLevel: 2, cooldown: 10, cost: 35, target: 'self',
      effects: [{ kind: 'heal', to: 'self', k: 1.2 }], text: 'Burn 35 Heat to heal yourself for {h}.',
    }),
    skill({
      id: 'inferno', name: 'Inferno', icon: 'inferno', unlockLevel: 4, cooldown: 8, cost: 50, target: 'around', radius: 4.8,
      effects: [{ kind: 'damage', k: 2 }], color: 0xff8a2a, text: 'Erupt for {d} to everything within {r}.',
    }),
  ],
  specs: [
    {
      id: 'duelist', name: 'Duelist', leaning: 'One target', passive: { crit: 0.1 },
      passiveText: '+10% crit chance.', changeText: 'Searing Edge cooldown 4 → 3 s; burn +50%.',
      patch: {
        searingEdge: {
          cooldown: 3,
          effects: [{ kind: 'damage', k: 1.4 }, { kind: 'status', to: 'enemies', status: { id: 'burn', name: 'Burning', seconds: 4, dot: 0.9 } }],
        },
      },
    },
    {
      id: 'wildfire', name: 'Wildfire', leaning: 'Packs', passive: { multiTarget: 0.1 },
      passiveText: '+10% damage when a skill hits two or more enemies.', changeText: 'Inferno reaches 6.3, costs 35 Heat and burns 0.6 P over 3 s.',
      patch: {
        inferno: {
          radius: 6.3, cost: 35,
          effects: [{ kind: 'damage', k: 2 }, { kind: 'status', to: 'enemies', status: { id: 'wildfire', name: 'Wildfire', seconds: 3, dot: 0.6 } }],
          text: 'Erupt for {d} to everything within {r}, then burn it for {o} over 3 s.',
        },
      },
    },
  ],
  rotation: [
    { skill: 'kindle', when: 'hurt' },
    { skill: 'inferno', when: 'always' },
    { skill: 'searingEdge', when: 'always' },
    { skill: 'slash', when: 'always' },
  ],
  targetOutput: 1.9,
};

const CHIMER: ClassDef = {
  id: 'chimer',
  name: 'Chimer',
  role: 'support',
  fantasy: 'A ringer of the Night Bell whose peals steady friends and shake foes.',
  primary: 'Spirit',
  weapon: 'bell',
  color: '#a6d8ff',
  health: 1.1,
  armor: 0.08,
  threat: 1,
  resource: { kind: 'mana', base: 50, perLevel: 9, startFull: true, regenInCombat: 2, regenOutOfCombat: 5, perHitTaken: 0 },
  strengths: 'Makes the whole party hit harder; control.',
  weaknesses: 'Weakest damage alone; mana-hungry.',
  skills: [
    skill({
      id: 'toll', name: 'Toll', icon: 'bell', cooldown: 1.1, target: 'enemy', delivery: 'projectile', range: 15,
      effects: [{ kind: 'damage', k: 1.15 }], color: 0xa6d8ff, text: 'Send a note for {d} at up to 15 blocks.',
    }),
    skill({
      id: 'peal', name: 'Rallying Peal', icon: 'horn', cooldown: 16, cost: 20, target: 'around', radius: 10,
      effects: [{ kind: 'status', to: 'allies', status: { id: 'peal', name: 'Rallying Peal', seconds: 10, damageDealt: 0.15 } }],
      color: 0xa6d8ff, text: 'You and allies within {r} deal 15% more damage for 10 s.',
    }),
    skill({
      id: 'discord', name: 'Discord', icon: 'discord', unlockLevel: 2, cooldown: 10, cost: 15, target: 'enemy', delivery: 'projectile', range: 15,
      effects: [{ kind: 'damage', k: 0.6 }, { kind: 'status', to: 'enemies', status: { id: 'discord', name: 'Discord', seconds: 8, damageTaken: 0.2, slow: 0.25 } }],
      color: 0xc69cff, text: 'Hit for {d}; the target takes 20% more damage and is slowed 25% for 8 s.',
    }),
    skill({
      id: 'hymn', name: 'Hymn of Mending', icon: 'note', unlockLevel: 4, cooldown: 14, cost: 25, target: 'around', radius: 10,
      effects: [{ kind: 'status', to: 'allies', status: { id: 'hymn', name: 'Hymn of Mending', seconds: 6, hot: 2 } }],
      color: 0x9ff0c0, text: 'You and allies within {r} heal {v} over 6 s.',
    }),
  ],
  specs: [
    {
      id: 'warbell', name: 'Warbell', leaning: 'Group damage', passive: { damage: 0.05 },
      passiveText: '+5% damage.', changeText: 'Rallying Peal gives 25% and reaches 14 blocks.',
      patch: {
        peal: {
          radius: 14,
          effects: [{ kind: 'status', to: 'allies', status: { id: 'peal', name: 'Rallying Peal', seconds: 10, damageDealt: 0.25 } }],
          text: 'You and allies within {r} deal 25% more damage for 10 s.',
        },
      },
    },
    {
      id: 'stillwater', name: 'Stillwater', leaning: 'Control and healing', passive: { healing: 0.25 },
      passiveText: '+25% healing.', changeText: 'Discord also stuns for 1.5 s (not bosses).',
      patch: {
        discord: {
          effects: [
            { kind: 'damage', k: 0.6 },
            { kind: 'status', to: 'enemies', status: { id: 'discord', name: 'Discord', seconds: 8, damageTaken: 0.2, slow: 0.25 } },
            { kind: 'status', to: 'enemies', status: { id: 'dazed', name: 'Dazed', seconds: 1.5, stun: true } },
          ],
          text: 'Hit for {d} and stun for 1.5 s; the target takes 20% more damage and is slowed 25% for 8 s.',
        },
      },
    },
  ],
  rotation: [
    { skill: 'hymn', when: 'hurt' },
    { skill: 'discord', when: 'always' },
    { skill: 'peal', when: 'always' },
    { skill: 'toll', when: 'always' },
  ],
  targetOutput: 1.4,
};

export const CLASSES: Readonly<Record<ClassId, ClassDef>> = {
  warden: WARDEN,
  lightkeeper: LIGHTKEEPER,
  ranger: RANGER,
  emberblade: EMBERBLADE,
  chimer: CHIMER,
};

export const CLASS_IDS = Object.keys(CLASSES) as readonly ClassId[];
export const SPEC_IDS: readonly SpecId[] = CLASS_IDS.flatMap((c) => CLASSES[c].specs.map((s) => s.id));
/** New heroes and saves from before classes start as Emberblades, the closest to the old kit. */
export const DEFAULT_CLASS: ClassId = 'emberblade';

export const isClassId = (v: unknown): v is ClassId => typeof v === 'string' && v in CLASSES;
export const isSpecId = (v: unknown): v is SpecId => typeof v === 'string' && SPEC_IDS.includes(v as SpecId);

/** The spec if it belongs to this class, else null. */
export const specOf = (cls: ClassId, spec: SpecId | null | undefined): SpecDef | null =>
  CLASSES[cls].specs.find((s) => s.id === spec) ?? null;

/** The spec a hero fights with: chosen for this class, and only from level 10. */
export const activeSpec = (cls: ClassId, specs: Readonly<Partial<Record<ClassId, SpecId>>>, level: number): SpecDef | null =>
  level >= SPEC_LEVEL ? specOf(cls, specs[cls]) : null;

const kits = new Map<string, readonly SkillDef[]>();

/** The class's four skills with the spec's changes applied. */
export function kitFor(cls: ClassId, spec: SpecDef | null): readonly SkillDef[] {
  const key = `${cls}/${spec?.id ?? ''}`;
  let kit = kits.get(key);
  if (!kit) {
    kit = CLASSES[cls].skills.map((s) => {
      const patch = spec?.patch[s.id as ClassSkillId];
      return patch ? { ...s, ...patch } : s;
    });
    kits.set(key, kit);
  }
  return kit;
}

/** A skill a hero of this class and spec can use (the tonic included), or null. */
export const skillOf = (cls: ClassId, spec: SpecDef | null, id: SkillId): SkillDef | null =>
  id === 'tonic' ? TONIC : kitFor(cls, spec).find((s) => s.id === id) ?? null;

export const ALL_SKILL_IDS: readonly SkillId[] = [...CLASS_IDS.flatMap((c) => CLASSES[c].skills.map((s) => s.id)), 'tonic'];
export const isSkillId = (v: unknown): v is SkillId => typeof v === 'string' && ALL_SKILL_IDS.includes(v as SkillId);

const NO_PASSIVE: Passive = {};
export const passiveOf = (spec: SpecDef | null): Passive => spec?.passive ?? NO_PASSIVE;

export const classMaxHp = (cls: ClassId, level: number, spec: SpecDef | null): number =>
  Math.round(maxHpFor(level) * CLASSES[cls].health * (1 + (passiveOf(spec).maxHp ?? 0)));

export const classArmor = (cls: ClassId, spec: SpecDef | null): number =>
  clamp(CLASSES[cls].armor + (passiveOf(spec).armor ?? 0), 0, DAMAGE_REDUCTION_CAP);

export const maxResourceFor = (cls: ClassId, level: number): number => {
  const r = CLASSES[cls].resource;
  return Math.round(r.base + r.perLevel * (level - 1));
};

/** Power: what every skill's numbers scale with. Today level and weapon tier; gear adds to it later. */
export const powerFor = (level: number, weaponTier: number): number => attackFor(level, weaponTier);

/** Clamps a summed modifier group to the shared caps. */
export const capModifier = (sum: number): number => clamp(sum, -DAMAGE_REDUCTION_CAP, MODIFIER_CAP);
