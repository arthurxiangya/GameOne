import type { Vec3 } from '../math/vec';

/**
 * Lantern Night: every few nights the Gloom marches on Emberhold and everyone online defends
 * the Great Lantern on top of the fountain. Numbers here are the whole balance of the mode.
 */
export const SIEGE = {
  /** A siege comes every this many nights. */
  everyNights: 3,
  /** Time of day (0..1) the Night Bell rings: 18:00. */
  dusk: 0.75,
  /** Seconds from the bell to the first wave. */
  warningSeconds: 45,
  /** A wave ends when cleared, or after this many seconds (except the last). */
  waveSeconds: 50,
  breakSeconds: 8,
  lanternBaseHp: 1000,
  lanternHpPerDefender: 250,
  /** Heroes this close to the fountain during a wave count as defenders. */
  defenderRadius: 45,
  /** Monsters this close to the fountain attack the Lantern. */
  plazaRadius: 4.6,
  /** Shade Stalkers and the Knight go after heroes this close, otherwise for the Lantern. */
  huntRadius: 12,
  minLevel: 2,
  maxLevel: 18,
  /** No wave sends more than this many monsters, whatever the crowd. */
  maxPerWave: 40,
  /** Win rewards. */
  winMarks: 2,
  topDamageMarks: 1,
  /** Kill XP bonus for winners, until the next dusk. */
  blessing: 0.1,
  /** Chance per defender of a Gloom Moth egg... hatched on the spot, after a win. */
  mothChance: 0.05,
  /** Wins needed for the Gloom Steed. */
  steedWins: 5,
} as const;

export interface WaveDef {
  /** [base, per extra defender] */
  readonly wisps: readonly [number, number];
  readonly shades: readonly [number, number];
  readonly knight: boolean;
  /** How many of the four gates the wave uses. */
  readonly gates: number;
}

export const WAVES: readonly WaveDef[] = [
  { wisps: [6, 1.5], shades: [0, 0], knight: false, gates: 2 },
  { wisps: [4, 1], shades: [3, 1], knight: false, gates: 3 },
  { wisps: [3, 1], shades: [5, 1.5], knight: false, gates: 3 },
  { wisps: [5, 1.5], shades: [7, 2], knight: false, gates: 4 },
  { wisps: [3, 1], shades: [3, 1], knight: true, gates: 4 },
];

/** How many of each monster a wave sends against `defenders` heroes. */
export function waveSize(wave: WaveDef, defenders: number): { wisps: number; shades: number } {
  const extra = Math.max(0, defenders - 1);
  let wisps = Math.round(wave.wisps[0] + wave.wisps[1] * extra);
  let shades = Math.round(wave.shades[0] + wave.shades[1] * extra);
  const total = wisps + shades;
  if (total > SIEGE.maxPerWave) {
    wisps = Math.round((wisps / total) * SIEGE.maxPerWave);
    shades = SIEGE.maxPerWave - wisps;
  }
  return { wisps, shades };
}

export const lanternMaxHp = (defenders: number): number => SIEGE.lanternBaseHp + SIEGE.lanternHpPerDefender * Math.max(1, defenders);

/** The Gloom Knight's health for a crowd of `defenders` at `level`. */
export const knightHp = (level: number, defenders: number): number => Math.round((400 + 120 * level) * (1 + 0.6 * Math.max(0, defenders - 1)));
export const knightDamage = (level: number): number => Math.round(6 + 3 * level);
export const knightSlamDamage = (level: number): number => Math.round(20 + 3 * level);

/** Monster level for a siege, from the defenders' average level. */
export const siegeLevel = (averageHeroLevel: number): number =>
  Math.max(SIEGE.minLevel, Math.min(SIEGE.maxLevel, Math.round(averageHeroLevel)));

export type SiegePhase = 'warning' | 'wave' | 'break' | 'won' | 'lost';

/** What every client is told about the current siege. Times are server simulation time. */
export interface SiegeState {
  readonly phase: SiegePhase;
  /** 1-based wave number (0 during the warning). */
  readonly wave: number;
  readonly waves: number;
  readonly lantern: number;
  readonly lanternMax: number;
  /** Monsters of the current wave still standing. */
  readonly remaining: number;
  /** When the current phase ends, or 0 if it ends on its own terms. */
  readonly endsAt: number;
  /** Indices into the generated world's siege gates that the current wave uses. */
  readonly gates: readonly number[];
}

/** The fountain the Lantern stands on. */
export const LANTERN_POSITION: Readonly<Vec3> = { x: 0, y: 16, z: 0 };
