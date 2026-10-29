import type { MonsterType } from './monsters';

/**
 * Rift Trials: a party of up to four is taken to a floating rift island, fights five waves
 * ending with the Rift Lord, and is scored against the clock.
 */
export const RIFT = {
  minLevel: 6,
  maxParty: 4,
  /** The gathering circle beside Seer Ilka in Emberhold. */
  circle: { x: -17, z: -6, radius: 3.5 },
  /** Seconds the circle stays open after someone asks Ilka to open a rift. */
  gatherSeconds: 10,
  /** Seconds on the island before the first wave. */
  startSeconds: 4,
  breakSeconds: 5,
  /** The whole run must be done within this. */
  timeLimit: 360,
  /** Seconds the party stays on the island after the Rift Lord falls. */
  endSeconds: 6,
  /** Radius of each floating arena's flat top. */
  arenaRadius: 7,
  /** Height of the arenas' floor. */
  arenaFloor: 22,
  /** Score: points per wave cleared, per second left after the Lord falls, lost per knock-out. */
  pointsPerWave: 1000,
  pointsPerSecond: 5,
  knockoutPenalty: 150,
  /** Rift monsters notice party members this far away (the whole island). */
  aggroRange: 20,
} as const;

/** Centres of the four rift islands, out past the corners of the realm. */
export const RIFT_ARENAS: readonly { readonly x: number; readonly z: number }[] = [
  { x: 68, z: 68 },
  { x: -68, z: 68 },
  { x: 68, z: -68 },
  { x: -68, z: -68 },
];

export interface RiftWave {
  /** Monsters and how many: [base, per extra party member]. */
  readonly monsters: readonly { readonly type: MonsterType; readonly count: readonly [number, number] }[];
  readonly lord: boolean;
}

export const RIFT_WAVES: readonly RiftWave[] = [
  { monsters: [{ type: 'puffcap', count: [3, 1] }, { type: 'toad', count: [3, 1] }], lord: false },
  { monsters: [{ type: 'boar', count: [3, 1] }, { type: 'scuttler', count: [3, 1] }], lord: false },
  { monsters: [{ type: 'shade', count: [3, 1] }, { type: 'golem', count: [2, 1] }], lord: false },
  {
    monsters: [{ type: 'boar', count: [2, 1] }, { type: 'scuttler', count: [2, 0.5] }, { type: 'golem', count: [2, 0.5] }, { type: 'shade', count: [2, 1] }],
    lord: false,
  },
  { monsters: [], lord: true },
];

/** Health fractions at which the Rift Lord calls Gloom Wisps to its side. */
export const LORD_SUMMONS: readonly number[] = [0.66, 0.33];

/** Monster health multiplier for a party of `members`. */
export const riftHpScale = (members: number): number => 1 + 0.5 * Math.max(0, members - 1);
export const riftLordHp = (level: number, members: number): number => Math.round((500 + 140 * level) * riftHpScale(members));
export const riftLordDamage = (level: number): number => Math.round(6 + 3 * level);

export function riftScore(wavesCleared: number, secondsLeft: number, lordDefeated: boolean, knockouts: number): number {
  const time = lordDefeated ? Math.max(0, Math.floor(secondsLeft)) * RIFT.pointsPerSecond : 0;
  return Math.max(0, wavesCleared * RIFT.pointsPerWave + time - knockouts * RIFT.knockoutPenalty);
}

/** Ember Marks for a run: one per two waves cleared. */
export const riftMarks = (wavesCleared: number): number => Math.floor(wavesCleared / 2);

export const isInRiftCircle = (x: number, z: number): boolean => Math.hypot(x - RIFT.circle.x, z - RIFT.circle.z) <= RIFT.circle.radius;
