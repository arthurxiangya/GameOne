export type MonsterType = 'puffcap' | 'toad' | 'boar' | 'scuttler' | 'golem' | 'warden' | 'wisp' | 'shade' | 'gloomknight' | 'riftlord';

export interface MonsterDef {
  readonly name: string;
  /** Walk speed in blocks per second. */
  readonly speed: number;
  /** Attack reach measured from the monster's body edge. */
  readonly reach: number;
  /** Body radius before scaling. */
  readonly radius: number;
  /** Model height before scaling. */
  readonly height: number;
  /** Passive monsters only fight back once hit. */
  readonly passive: boolean;
  readonly boss: boolean;
  /** Fixed scale for bosses; regular monsters vary slightly around 1. */
  readonly scale: number | null;
  readonly aggroRange: number;
  /** Distance from its spawn point at which a monster gives up the chase. */
  readonly leash: number;
  readonly attackInterval: number;
  readonly windup: number;
  readonly respawnSeconds: number;
}

export const MONSTERS: Readonly<Record<MonsterType, MonsterDef>> = {
  puffcap: {
    name: 'Puffcap', speed: 2.2, reach: 1.2, radius: 0.5, height: 1.0, passive: true, boss: false, scale: null,
    aggroRange: 0, leash: 24, attackInterval: 1.6, windup: 0.38, respawnSeconds: 22,
  },
  toad: {
    name: 'Bog Toad', speed: 2.4, reach: 1.4, radius: 0.6, height: 0.9, passive: true, boss: false, scale: null,
    aggroRange: 0, leash: 24, attackInterval: 1.6, windup: 0.38, respawnSeconds: 22,
  },
  boar: {
    name: 'Bramble Boar', speed: 3.4, reach: 1.6, radius: 0.75, height: 1.2, passive: false, boss: false, scale: null,
    aggroRange: 7.5, leash: 26, attackInterval: 1.6, windup: 0.38, respawnSeconds: 22,
  },
  scuttler: {
    name: 'Dune Scuttler', speed: 3.0, reach: 1.6, radius: 0.75, height: 1.3, passive: false, boss: false, scale: null,
    aggroRange: 7.5, leash: 26, attackInterval: 1.6, windup: 0.38, respawnSeconds: 22,
  },
  golem: {
    name: 'Frost Golem', speed: 2.4, reach: 2.0, radius: 0.95, height: 2.4, passive: false, boss: false, scale: null,
    aggroRange: 7.5, leash: 26, attackInterval: 1.6, windup: 0.38, respawnSeconds: 25,
  },
  warden: {
    name: 'Warden of the Frost Heart', speed: 2.7, reach: 2.2, radius: 2.0, height: 2.4, passive: false, boss: true,
    scale: 2.1, aggroRange: 13, leash: 20, attackInterval: 2.2, windup: 0.38, respawnSeconds: 90,
  },
  // The Gloom: Lantern Night only. They are spawned by the siege, march on the Great Lantern and never respawn.
  wisp: {
    name: 'Gloom Wisp', speed: 4.2, reach: 1.2, radius: 0.45, height: 1.4, passive: true, boss: false, scale: null,
    aggroRange: 0, leash: 500, attackInterval: 1.4, windup: 0.3, respawnSeconds: 0,
  },
  shade: {
    name: 'Shade Stalker', speed: 3.6, reach: 1.5, radius: 0.6, height: 1.9, passive: false, boss: false, scale: null,
    aggroRange: 12, leash: 500, attackInterval: 1.5, windup: 0.38, respawnSeconds: 0,
  },
  gloomknight: {
    name: 'Gloom Knight', speed: 2.9, reach: 2.2, radius: 1.4, height: 2.6, passive: false, boss: true,
    scale: 1.7, aggroRange: 14, leash: 500, attackInterval: 2.0, windup: 0.4, respawnSeconds: 0,
  },
  // Rift Trials only.
  riftlord: {
    name: 'Rift Lord', speed: 2.6, reach: 2.2, radius: 1.6, height: 2.4, passive: false, boss: true,
    scale: 1.8, aggroRange: 20, leash: 500, attackInterval: 2.1, windup: 0.4, respawnSeconds: 0,
  },
};

export const MONSTER_TYPES = Object.keys(MONSTERS) as readonly MonsterType[];

export const isMonsterType = (v: unknown): v is MonsterType => typeof v === 'string' && v in MONSTERS;

export function monsterMaxHp(type: MonsterType, level: number): number {
  return MONSTERS[type].boss ? 2600 : Math.round(28 + 24 * (level - 1));
}

export function monsterDamage(type: MonsterType, level: number): number {
  return MONSTERS[type].boss ? 34 : Math.round(4 + 2.3 * level);
}

/** Boss slam: telegraphed area attack. */
export const SLAM = { radius: 5.4, delay: 1.25, damage: 55, cooldown: 8, triggerRange: 8 } as const;
