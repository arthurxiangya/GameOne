export const Biome = {
  Meadow: 0,
  North: 1,
  East: 2,
  South: 3,
  West: 4,
  Town: 5,
  /** The floating rift islands past the corners of the realm. */
  Rift: 6,
  None: 255,
} as const;

export type BiomeId = (typeof Biome)[keyof typeof Biome];

export interface ZoneInfo {
  readonly name: string;
  readonly levels: string;
  readonly x: number;
  readonly z: number;
}

const ZONES: Readonly<Record<number, ZoneInfo>> = {
  [Biome.Meadow]: { name: 'Sunmeadow', levels: 'Level 1–3', x: 0, z: 26 },
  [Biome.North]: { name: 'Frostspine Peaks', levels: 'Level 10–14', x: 0, z: -52 },
  [Biome.East]: { name: 'Lanternwood', levels: 'Level 5–7', x: 50, z: 0 },
  [Biome.South]: { name: 'Amber Dunes', levels: 'Level 7–9', x: 0, z: 50 },
  [Biome.West]: { name: 'Reedmere', levels: 'Level 3–5', x: -50, z: 0 },
  [Biome.Town]: { name: 'Emberhold', levels: 'Safe haven', x: 0, z: 0 },
  [Biome.Rift]: { name: 'The Rift', levels: 'Rift Trial', x: 68, z: 68 },
};

export const zoneForBiome = (biome: number): ZoneInfo | null => ZONES[biome] ?? null;
