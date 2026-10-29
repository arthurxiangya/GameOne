import type { MonsterType } from '../game/monsters';
import { NPC_PLACEMENTS, type NpcDef } from '../game/npcs';
import type { RaceCourse } from '../game/race';
import { RIFT, RIFT_ARENAS } from '../game/rift';
import { ValueNoise } from '../math/noise';
import { Mulberry32, type RandomSource } from '../math/random';
import { clamp, lerp, smoothstep } from '../math/scalar';
import type { Vec3 } from '../math/vec';
import { Biome } from './biomes';
import { Block } from './blocks';
import { LANDMARK_NAMES, type Landmark, type LandmarkId } from './landmarks';
import { NO_GROUND, VoxelWorld, WORLD } from './voxel-world';

export interface MonsterSpawn {
  readonly type: MonsterType;
  readonly level: number;
  readonly x: number;
  readonly z: number;
}

export interface Waterfall {
  readonly x: number;
  readonly z: number;
  /** Outward direction off the island edge. */
  readonly dx: number;
  readonly dz: number;
}

export interface GeneratedWorld {
  readonly seed: number;
  readonly world: VoxelWorld;
  readonly monsterSpawns: readonly MonsterSpawn[];
  readonly lampPoints: readonly Vec3[];
  readonly waterfalls: readonly Waterfall[];
  readonly playerSpawn: Readonly<Vec3>;
  /** Named places for stories and bounties, each marked by a small structure. */
  readonly landmarks: readonly Landmark[];
  /** Every character, with zone characters moved onto solid ground. */
  readonly npcs: readonly NpcDef[];
  /** The Ember Run: start line in Emberhold and checkpoints through every zone. */
  readonly raceCourse: RaceCourse;
  /** Where the Gloom enters on Lantern Night: the four roads, north, east, south and west. */
  readonly siegeGates: readonly Vec3[];
  /** The floating rift islands for Rift Trials; `y` is the floor heroes stand on. */
  readonly riftArenas: readonly Vec3[];
}

interface House {
  readonly x: number;
  readonly z: number;
  readonly roof: number;
}

const ISLAND_RADIUS = 70;
const WATER = WORLD.waterLevel;
const TOWN_Y = WORLD.townY;
const HOUSES: readonly House[] = [
  { x: 9, z: 9, roof: Block.RoofRed },
  { x: -9, z: 9, roof: Block.RoofTeal },
  { x: -9, z: -9, roof: Block.RoofRed },
  { x: 9, z: -9, roof: Block.RoofTeal },
];
const N4: readonly (readonly [number, number])[] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const N8: readonly (readonly [number, number])[] = [...N4, [1, 1], [-1, 1], [1, -1], [-1, -1]];

/**
 * Builds the whole realm from a seed. Pure and deterministic: the server and every
 * client generate identical worlds, so terrain never has to cross the network.
 */
export function generateWorld(seed: number): GeneratedWorld {
  const world = new VoxelWorld();
  const noise = new ValueNoise(seed);
  const rng = new Mulberry32(seed ^ 0x5eed);

  shapeTerrain(world, noise);
  relaxSlopes(world);
  paintColumns(world, noise);
  const lampPoints = buildTown(world);
  plantTrees(world, noise);
  const landmarks = placeLandmarks(world, lampPoints);
  const npcs = placeNpcs(world);
  const raceCourse = placeRaceCourse(world);
  const siegeGates = ([[0, -30], [30, 0], [0, 30], [-30, 0]] as const).map(([nx, nz]) => {
    const spot = nearest(world, nx, nz, 8, (x, z) => isStandable(world, x, z)) ?? { x: nx, z: nz };
    return { x: spot.x, y: world.surfaceY(spot.x, spot.z), z: spot.z };
  });
  const riftArenas = RIFT_ARENAS.map((c) => buildRiftArena(world, c.x, c.z));
  buildRiftCircle(world);
  world.computeColumnExtents();

  return {
    seed,
    world,
    monsterSpawns: placeMonsters(world, rng),
    lampPoints,
    waterfalls: findWaterfalls(world),
    playerSpawn: { x: 0, y: TOWN_Y + 0.5, z: 5 },
    landmarks,
    npcs,
    raceCourse,
    siegeGates,
    riftArenas,
  };
}

const cube = (v: number): number => (v > 0 ? v * v * v : 0);

/** Island outline, biome weights and raw heights. */
function shapeTerrain(world: VoxelWorld, noise: ValueNoise): void {
  world.forEachColumn((x, z, i) => {
    const d = Math.hypot(x, z);
    const edge = ISLAND_RADIUS + (noise.fbm(x * 0.04 + 40, z * 0.04 - 17, 31) - 0.5) * 14;
    if (d > edge || d > 77) return;

    const a = Math.atan2(z, x) + (noise.fbm(x * 0.03 - 8, z * 0.03 + 21, 35) - 0.5) * 1.1;
    const wE = cube(Math.cos(a));
    const wS = cube(Math.cos(a - Math.PI / 2));
    const wW = cube(Math.cos(a - Math.PI));
    const wN = cube(Math.cos(a + Math.PI / 2));
    const sum = wE + wS + wW + wN || 1;
    const outer = smoothstep(24, 40, d);

    const meadow = 12.5 + noise.fbm(x * 0.05, z * 0.05, 3) * 5;
    const ridge = 1 - Math.abs(2 * noise.fbm(x * 0.035 + 9, z * 0.035 - 4, 11) - 1);
    const north = 14 + ridge * ridge * 30 * smoothstep(28, 58, d) + noise.fbm(x * 0.08, z * 0.08, 14) * 5;
    const east = 12 + noise.fbm(x * 0.06, z * 0.06, 17) * 9;
    const dunes = Math.sin(x * 0.17 + z * 0.05 + noise.fbm(x * 0.04, z * 0.04, 20) * 5) * 0.5 + 0.5;
    const south = 10 + dunes * 4 + noise.fbm(x * 0.07, z * 0.07, 23) * 3;
    const west = 1.5 + noise.fbm(x * 0.045, z * 0.045, 26) * 11 - smoothstep(50, 68, d) * 3;

    let h = (1 - outer) * meadow + (outer * (wN * north + wE * east + wS * south + wW * west)) / sum;
    h = lerp(TOWN_Y, h, smoothstep(20, 28, d));

    world.topY[i] = clamp(Math.round(h), 3, 42);
    world.edgeDistance[i] = edge - d;

    let b: number;
    if (d < 20.5) b = Biome.Town;
    else if (d < 33 + (noise.fbm(x * 0.06, z * 0.06, 37) - 0.5) * 8) b = Biome.Meadow;
    else {
      const m = Math.max(wN, wE, wS, wW);
      b = m === wN ? Biome.North : m === wE ? Biome.East : m === wS ? Biome.South : Biome.West;
    }
    world.biome[i] = b;
  });
}

/** Lowers terrain until every step is at most one block, so the realm is walkable without jumping. */
function relaxSlopes(world: VoxelWorld): void {
  const top = world.topY;
  const D = WORLD.depth;
  const relax = (x: number, z: number): boolean => {
    const i = world.column(x, z);
    const t = top[i]!;
    if (t === NO_GROUND) return false;
    let m = Number.POSITIVE_INFINITY;
    let v: number;
    if (x + 1 <= world.maxX && (v = top[i + D]!) !== NO_GROUND) m = Math.min(m, Math.max(v, WATER - 1));
    if (x - 1 >= world.minX && (v = top[i - D]!) !== NO_GROUND) m = Math.min(m, Math.max(v, WATER - 1));
    if (z + 1 <= world.maxZ && (v = top[i + 1]!) !== NO_GROUND) m = Math.min(m, Math.max(v, WATER - 1));
    if (z - 1 >= world.minZ && (v = top[i - 1]!) !== NO_GROUND) m = Math.min(m, Math.max(v, WATER - 1));
    if (m + 1 < t) {
      top[i] = m + 1;
      return true;
    }
    return false;
  };
  for (let pass = 0; pass < 80; pass++) {
    let changed = false;
    if (pass % 2 === 0) {
      for (let x = world.minX; x <= world.maxX; x++) for (let z = world.minZ; z <= world.maxZ; z++) changed = relax(x, z) || changed;
    } else {
      for (let x = world.maxX; x >= world.minX; x--) for (let z = world.maxZ; z >= world.minZ; z--) changed = relax(x, z) || changed;
    }
    if (!changed) break;
  }
}

/** Fills each column with blocks: surface by biome, soil, stone, and the tapered underside. */
function paintColumns(world: VoxelWorld, noise: ValueNoise): void {
  const isWaterColumn = (x: number, z: number): boolean => {
    if (!world.inXZ(x, z)) return false;
    const t = world.topY[world.column(x, z)]!;
    return t !== NO_GROUND && t < WATER;
  };
  world.forEachColumn((x, z, i) => {
    const t = world.topY[i]!;
    if (t === NO_GROUND) return;
    const b = world.biome[i]!;
    const d = Math.hypot(x, z);
    const nearWater = N8.some(([dx, dz]) => isWaterColumn(x + dx, z + dz));

    let surface: number;
    if (t < WATER || (nearWater && t <= WATER + 1)) surface = Block.Sand;
    else if (b === Biome.North) surface = t >= 31 ? Block.Snow : t >= 25 ? Block.Stone : Block.Grass;
    else if (b === Biome.East) surface = Block.ForestGrass;
    else if (b === Biome.South) surface = Block.Sand;
    else if (b === Biome.West) surface = Block.Marsh;
    else surface = Block.Grass;
    if (d < 9.5) surface = Block.Cobble;
    else if (d < 46 && (Math.abs(x) <= 1 || Math.abs(z) <= 1) && t >= WATER) surface = Block.Path;

    const bottom = Math.max(-20, Math.min(t - 3, t - 3 - Math.round(world.edgeDistance[i]! * 2.2 + noise.hash(x, z, 40) * 3)));
    for (let y = bottom; y <= t; y++) {
      let id: number;
      if (y === t) id = surface;
      else if (t - y <= 3) {
        if (surface === Block.Sand) id = b === Biome.South ? Block.Sandstone : Block.Sand;
        else if (surface === Block.Snow || surface === Block.Stone || surface === Block.Cobble) id = Block.Stone;
        else id = Block.Dirt;
      } else id = y < 2 ? Block.DeepStone : Block.Stone;
      world.set(x, y, z, id);
    }
    for (let y = t + 1; y <= WATER; y++) world.set(x, y, z, Block.Water);
  });
}

/** Emberhold: fountain, lamp posts and four houses around the plaza. Returns light positions. */
function buildTown(world: VoxelWorld): Vec3[] {
  for (let dx = -2; dx <= 2; dx++) {
    for (let dz = -2; dz <= 2; dz++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) === 2) world.set(dx, TOWN_Y + 1, dz, Block.Cobble);
      else if (dx !== 0 || dz !== 0) world.set(dx, TOWN_Y + 1, dz, Block.Water);
    }
  }
  for (let y = TOWN_Y + 1; y <= TOWN_Y + 3; y++) world.set(0, y, 0, Block.Cobble);
  world.set(0, TOWN_Y + 4, 0, Block.Lamp);
  const lamps: Vec3[] = [{ x: 0, y: TOWN_Y + 4, z: 0 }];

  for (let k = 0; k < 8; k++) {
    const a = ((k + 0.5) * Math.PI) / 4;
    const x = Math.round(Math.cos(a) * 8.6);
    const z = Math.round(Math.sin(a) * 8.6);
    world.set(x, TOWN_Y + 1, z, Block.Wood);
    world.set(x, TOWN_Y + 2, z, Block.Wood);
    world.set(x, TOWN_Y + 3, z, Block.Lamp);
    lamps.push({ x, y: TOWN_Y + 3, z });
  }

  for (const h of HOUSES) buildHouse(world, h);
  return lamps;
}

function buildHouse(world: VoxelWorld, h: House): void {
  const doorSide = -3 * Math.sign(h.x);
  for (let dx = -3; dx <= 3; dx++) {
    for (let dz = -3; dz <= 3; dz++) {
      const x = h.x + dx;
      const z = h.z + dz;
      world.set(x, TOWN_Y, z, Block.Cobble);
      for (let y = TOWN_Y + 1; y <= TOWN_Y + 4; y++) world.set(x, y, z, Block.Air);
      const onX = Math.abs(dx) === 3;
      const onZ = Math.abs(dz) === 3;
      if (!onX && !onZ) continue;
      const doorWall = onX && dx === doorSide;
      const corner = onX && onZ;
      for (let y = TOWN_Y + 1; y <= TOWN_Y + 4; y++) {
        let id: number = corner ? Block.Wood : Block.Plank;
        if (doorWall && dz === 0 && y <= TOWN_Y + 2) id = Block.Air;
        else if (y === TOWN_Y + 2 && !corner && !doorWall && ((onX && Math.abs(dz) === 1) || (onZ && Math.abs(dx) === 1))) id = Block.Window;
        world.set(x, y, z, id);
      }
    }
  }
  for (let k = 0; k < 4; k++) {
    const half = 4 - k;
    for (let dx = -half; dx <= half; dx++) {
      for (let dz = -half; dz <= half; dz++) world.set(h.x + dx, TOWN_Y + 5 + k, h.z + dz, h.roof);
    }
  }
}

function plantTrees(world: VoxelWorld, noise: ValueNoise): void {
  const setIfAir = (x: number, y: number, z: number, id: number): void => {
    if (world.get(x, y, z) === Block.Air) world.set(x, y, z, id);
  };

  const leafy = (x: number, z: number, t: number, leaves: readonly number[]): void => {
    const h = 4 + Math.floor(noise.hash(x, z, 51) * 2);
    for (let k = 1; k <= h; k++) world.set(x, t + k, z, Block.Wood);
    const cy = t + h;
    for (let dy = -1; dy <= 2; dy++) {
      const r = dy <= 0 ? 2 : 1;
      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
          const ax = Math.abs(dx);
          const az = Math.abs(dz);
          if (dy <= 0 && ax === 2 && az === 2) continue;
          if (dy === 2 && ax + az > 1) continue;
          if (dy <= 0 && ax === 0 && az === 0) continue;
          if ((ax === r || az === r) && noise.hash(x + dx * 7, cy + dy, z + dz * 13) < 0.14) continue;
          setIfAir(x + dx, cy + dy, z + dz, leaves[Math.floor(noise.hash(x + dx, cy * 17 + dy, z + dz) * leaves.length)]!);
        }
      }
    }
  };

  const pine = (x: number, z: number, t: number): void => {
    const h = 6 + Math.floor(noise.hash(x, z, 52) * 3);
    const snowy = t >= 22;
    for (let k = 1; k <= h; k++) world.set(x, t + k, z, Block.Wood);
    for (let k = 0; k <= h - 2; k++) {
      const y = t + 3 + k;
      let r = Math.min(2, Math.round((h - 2 - k) * 0.5));
      if (k % 2 === 1 && r > 0) r--;
      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
          if (Math.abs(dx) + Math.abs(dz) > r + (r === 2 ? 1 : 0)) continue;
          if (dx === 0 && dz === 0 && y <= t + h) continue;
          const snowTip = snowy && (k === h - 2 || noise.hash(x + dx, y, z + dz) < 0.25);
          setIfAir(x + dx, y, z + dz, snowTip ? Block.Snow : Block.Pine);
        }
      }
    }
  };

  const cactus = (x: number, z: number, t: number): void => {
    const h = 2 + Math.floor(noise.hash(x, z, 53) * 3);
    for (let k = 1; k <= h; k++) world.set(x, t + k, z, Block.Cactus);
    if (h >= 3 && noise.hash(x, z, 54) < 0.6) {
      const s = noise.hash(x, z, 55) < 0.5 ? 1 : -1;
      setIfAir(x + s, t + 2, z, Block.Cactus);
      setIfAir(x + s, t + 3, z, Block.Cactus);
    }
  };

  const autumn: readonly (readonly number[])[] = [
    [Block.LeafOrange, Block.LeafOrange, Block.LeafGold],
    [Block.LeafRed, Block.LeafRed, Block.LeafOrange],
    [Block.LeafGold, Block.LeafGold, Block.LeafOrange],
  ];
  const occupied = new Uint8Array(WORLD.width * WORLD.depth);

  world.forEachColumn((x, z, i) => {
    const t = world.topY[i]!;
    if (t === NO_GROUND || t < WATER + 1 || occupied[i] || world.edgeDistance[i]! < 2.5) return;
    const b = world.biome[i]!;
    if (b === Biome.Town) return;
    const surface = world.get(x, t, z);
    if (surface === Block.Path || surface === Block.Cobble || (surface === Block.Sand && b !== Biome.South)) return;

    let density = 0;
    if (b === Biome.Meadow) density = 0.014;
    else if (b === Biome.East) density = 0.075;
    else if (b === Biome.North) density = t <= 28 ? 0.05 : 0;
    else if (b === Biome.West) density = 0.022;
    else if (b === Biome.South) density = 0.009;
    if (density === 0 || noise.hash(x, z, 50) > density) return;

    if (b === Biome.East) leafy(x, z, t, autumn[Math.floor(noise.hash(x, z, 56) * autumn.length)]!);
    else if (b === Biome.North) pine(x, z, t);
    else if (b === Biome.South) cactus(x, z, t);
    else leafy(x, z, t, [Block.LeafGreen]);

    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) if (world.inXZ(x + dx, z + dz)) occupied[world.column(x + dx, z + dz)] = 1;
    }
  });
}

function placeMonsters(world: VoxelWorld, rng: RandomSource): MonsterSpawn[] {
  const spawns: MonsterSpawn[] = [];
  const used: { x: number; z: number }[] = [];
  const canStand = (x: number, z: number): boolean => {
    const i = world.column(x, z);
    const t = world.topY[i]!;
    return (
      t !== NO_GROUND && t >= WATER && world.edgeDistance[i]! > 5 &&
      !world.isSolid(x, t + 1, z) && !world.isSolid(x, t + 2, z) && world.get(x, t + 1, z) !== Block.Water
    );
  };

  // The Warden takes the highest standable point in the north.
  let boss: { x: number; z: number; top: number } | null = null;
  world.forEachColumn((x, z, i) => {
    if (world.biome[i] !== Biome.North || world.edgeDistance[i]! < 8 || !canStand(x, z)) return;
    if (!boss || world.topY[i]! > boss.top) boss = { x, z, top: world.topY[i]! };
  });
  const bossSpot = boss as { x: number; z: number; top: number } | null;
  if (bossSpot) {
    spawns.push({ type: 'warden', level: 14, x: bossSpot.x, z: bossSpot.z });
    used.push(bossSpot);
  }

  const scatter = (type: MonsterType, biome: number, count: number, minLevel: number, maxLevel: number, extra?: (x: number, z: number, i: number) => boolean): void => {
    let placed = 0;
    for (let tries = 0; placed < count && tries < 6000; tries++) {
      const x = Math.floor(rng.next() * WORLD.width) + world.minX;
      const z = Math.floor(rng.next() * WORLD.depth) + world.minZ;
      const i = world.column(x, z);
      if (world.biome[i] !== biome || !canStand(x, z) || (extra && !extra(x, z, i))) continue;
      if (used.some((u) => Math.hypot(u.x - x, u.z - z) < 5.5)) continue;
      used.push({ x, z });
      spawns.push({ type, level: minLevel + Math.floor(rng.next() * (maxLevel - minLevel + 1)), x, z });
      placed++;
    }
  };

  scatter('puffcap', Biome.Meadow, 13, 1, 3);
  scatter('toad', Biome.West, 10, 3, 5);
  scatter('boar', Biome.East, 11, 5, 7);
  scatter('scuttler', Biome.South, 11, 7, 9);
  scatter('golem', Biome.North, 9, 10, 12, (x, z, i) =>
    world.topY[i]! >= 17 && (!bossSpot || Math.hypot(bossSpot.x - x, bossSpot.z - z) > 13));
  return spawns;
}

function findWaterfalls(world: VoxelWorld): Waterfall[] {
  const falls: Waterfall[] = [];
  world.forEachColumn((x, z, i) => {
    const t = world.topY[i]!;
    if (t === NO_GROUND || t >= WATER || falls.length >= 4) return;
    for (const [dx, dz] of N4) {
      const nx = x + dx;
      const nz = z + dz;
      const offIsland = !world.inXZ(nx, nz) || world.topY[world.column(nx, nz)] === NO_GROUND;
      if (offIsland && !falls.some((f) => Math.hypot(f.x - x, f.z - z) < 16)) {
        falls.push({ x: x + dx * 0.48, z: z + dz * 0.48, dx, dz });
      }
    }
  });
  return falls.slice(0, 4);
}

// ---------------------------------------------------------------- landmarks and characters

/** Dry ground a hero can stand on, with no block in the two cells above. */
function isStandable(world: VoxelWorld, x: number, z: number): boolean {
  if (!world.inXZ(x, z)) return false;
  const i = world.column(x, z);
  const t = world.topY[i]!;
  return (
    t !== NO_GROUND && t >= WATER && world.edgeDistance[i]! > 2.5 &&
    !world.isSolid(x, t + 1, z) && !world.isSolid(x, t + 2, z) && world.get(x, t + 1, z) !== Block.Water
  );
}

/** Standable, and the square of `radius` around it is open, dry and within a block of its height. */
function isOpenGround(world: VoxelWorld, x: number, z: number, radius: number): boolean {
  if (!isStandable(world, x, z)) return false;
  const t = world.topY[world.column(x, z)]!;
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dz = -radius; dz <= radius; dz++) {
      if (!isStandable(world, x + dx, z + dz)) return false;
      const n = world.topY[world.column(x + dx, z + dz)]!;
      if (Math.abs(n - t) > 1 || world.isSolid(x + dx, n + 3, z + dz)) return false;
    }
  }
  return true;
}

/** The column nearest (nx, nz) within `radius` that passes `ok`; ties go to the smaller x, then z. */
function nearest(world: VoxelWorld, nx: number, nz: number, radius: number, ok: (x: number, z: number, i: number) => boolean): { x: number; z: number } | null {
  let best: { x: number; z: number } | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let x = Math.round(nx) - radius; x <= Math.round(nx) + radius; x++) {
    for (let z = Math.round(nz) - radius; z <= Math.round(nz) + radius; z++) {
      if (!world.inXZ(x, z)) continue;
      const d = Math.hypot(x - nx, z - nz);
      if (d > radius || d >= bestDistance || !ok(x, z, world.column(x, z))) continue;
      best = { x, z };
      bestDistance = d;
    }
  }
  return best;
}

/** Tries each finder in turn, so a landmark exists on every seed even if its ideal spot does not. */
function firstSpot(...finders: (() => { x: number; z: number } | null)[]): { x: number; z: number } {
  for (const find of finders) {
    const spot = find();
    if (spot) return spot;
  }
  return { x: 0, z: 14 };
}

function landmarkAt(world: VoxelWorld, id: LandmarkId, spot: { x: number; z: number }): Landmark {
  return { id, name: LANDMARK_NAMES[id], x: spot.x, y: world.surfaceY(spot.x, spot.z), z: spot.z };
}

function placeLandmarks(world: VoxelWorld, lamps: Vec3[]): Landmark[] {
  return [buildSunkenPier(world, lamps), buildHollowShrine(world), buildRiftLookout(world, lamps)];
}

/** A short wooden pier running from the Reedmere shore into the lake, its far end sunk under the water. */
function buildSunkenPier(world: VoxelWorld, lamps: Vec3[]): Landmark {
  const waterRun = (x: number, z: number, dx: number, dz: number): number => {
    let n = 0;
    while (n < 5) {
      const cx = x + dx * (n + 1);
      const cz = z + dz * (n + 1);
      if (!world.inXZ(cx, cz)) break;
      const t = world.topY[world.column(cx, cz)]!;
      if (t === NO_GROUND || t >= WATER) break;
      n++;
    }
    return n;
  };
  let direction: readonly [number, number] = [-1, 0];
  const shore = (x: number, z: number, i: number): boolean => {
    if (world.biome[i] !== Biome.West || !isStandable(world, x, z) || world.topY[i]! > WATER + 1) return false;
    for (const d of N4) {
      if (waterRun(x, z, d[0], d[1]) >= 4) {
        direction = d;
        return true;
      }
    }
    return false;
  };
  const spot = firstSpot(
    () => nearest(world, -58, 4, 40, shore),
    () => nearest(world, -58, 4, 40, (x, z, i) => world.biome[i] === Biome.West && isStandable(world, x, z)),
  );
  const found = nearest(world, spot.x, spot.z, 0, shore);
  if (found) {
    const [dx, dz] = direction;
    for (let k = 1; k <= 4; k++) {
      const x = spot.x + dx * k;
      const z = spot.z + dz * k;
      const deep = world.topY[world.column(x, z)]! < WATER - 1;
      world.set(x, k > 2 && deep ? WATER - 1 : WATER, z, Block.Plank);
    }
    const postX = spot.x + dx * 2 + dz;
    const postZ = spot.z + dz * 2 + dx;
    for (let y = WATER; y <= WATER + 2; y++) world.set(postX, y, postZ, Block.Wood);
    world.set(postX, WATER + 3, postZ, Block.Lamp);
    lamps.push({ x: postX, y: WATER + 3, z: postZ });
  }
  return landmarkAt(world, 'sunken-pier', spot);
}

/** Four stone pillars around a cold pedestal in the autumn woods. */
function buildHollowShrine(world: VoxelWorld): Landmark {
  const spot = firstSpot(
    () => nearest(world, 46, -12, 30, (x, z, i) => world.biome[i] === Biome.East && isOpenGround(world, x, z, 2)),
    () => nearest(world, 46, -12, 30, (x, z, i) => world.biome[i] === Biome.East && isOpenGround(world, x, z, 1)),
    () => nearest(world, 46, -12, 30, (x, z, i) => world.biome[i] === Biome.East && isStandable(world, x, z)),
  );
  const t = world.topY[world.column(spot.x, spot.z)]!;
  if (isOpenGround(world, spot.x, spot.z, 2)) {
    for (const [dx, dz] of [[2, 2], [2, -2], [-2, 2], [-2, -2]] as const) {
      const base = world.topY[world.column(spot.x + dx, spot.z + dz)]!;
      for (let y = base + 1; y <= base + 3; y++) world.set(spot.x + dx, y, spot.z + dz, Block.Cobble);
      world.set(spot.x + dx, base + 4, spot.z + dz, Block.Stone);
    }
  }
  // The pedestal and its dead lantern sit just behind the spot a hero stands on.
  world.set(spot.x, t + 1, spot.z - 1, Block.Cobble);
  world.set(spot.x, t + 2, spot.z - 1, Block.Wood);
  return landmarkAt(world, 'hollow-shrine', spot);
}

/** A sandstone pillar with a lamp, on the southern cliffs facing the rift islands. */
function buildRiftLookout(world: VoxelWorld, lamps: Vec3[]): Landmark {
  const cliff = (x: number, z: number, i: number): boolean =>
    world.biome[i] === Biome.South && world.edgeDistance[i]! < 10 && isOpenGround(world, x, z, 1);
  const spot = firstSpot(
    () => nearest(world, 38, 54, 30, cliff),
    () => nearest(world, 38, 54, 40, (x, z, i) => world.biome[i] === Biome.South && isStandable(world, x, z)),
  );
  const px = spot.x - 1;
  const pz = spot.z - 1;
  if (world.inXZ(px, pz) && world.topY[world.column(px, pz)] !== NO_GROUND) {
    const base = world.topY[world.column(px, pz)]!;
    for (let y = base + 1; y <= base + 3; y++) world.set(px, y, pz, Block.Sandstone);
    world.set(px, base + 4, pz, Block.Lamp);
    lamps.push({ x: px, y: base + 4, z: pz });
  }
  return landmarkAt(world, 'rift-lookout', spot);
}

function placeNpcs(world: VoxelWorld): NpcDef[] {
  return NPC_PLACEMENTS.map(({ snap, ...npc }) => {
    if (!snap) return npc;
    const spot = firstSpot(
      () => nearest(world, npc.x, npc.z, 12, (x, z) => isOpenGround(world, x, z, 1)),
      () => nearest(world, npc.x, npc.z, 20, (x, z) => isStandable(world, x, z)),
    );
    return { ...npc, x: spot.x, z: spot.z };
  });
}

/**
 * Checkpoints on a loop through every zone, in order: Sunmeadow, the Amber Dunes, Reedmere,
 * the Frostspine foothills and Lanternwood, then back to the start line on the south road.
 */
const RACE_LOOP: readonly (readonly [number, number])[] = [
  [14, 26], [0, 46], [-30, 38], [-46, 6], [-28, -32], [0, -40], [34, -26], [44, 8],
];

function placeRaceCourse(world: VoxelWorld): RaceCourse {
  const at = (x: number, z: number): Vec3 => ({ x, y: world.surfaceY(x, z), z });
  const checkpoints = RACE_LOOP.map(([nx, nz]) => {
    const spot = nearest(world, nx, nz, 10, (x, z) => isStandable(world, x, z)) ?? { x: nx, z: nz };
    return at(spot.x, spot.z);
  });
  return { start: at(0, 13), checkpoints };
}

/**
 * A round floating island of dark stone past a corner of the realm, walled so a careless step
 * does not end a run, with four glowing pillars. Its columns get terrain heights like the
 * island's, so monsters and the minimap treat it as ground.
 */
function buildRiftArena(world: VoxelWorld, cx: number, cz: number): Vec3 {
  const r = RIFT.arenaRadius;
  const floor = RIFT.arenaFloor;
  for (let dx = -r - 1; dx <= r + 1; dx++) {
    for (let dz = -r - 1; dz <= r + 1; dz++) {
      const x = cx + dx;
      const z = cz + dz;
      const d = Math.hypot(dx, dz);
      if (!world.inXZ(x, z) || d > r + 0.5) continue;
      const i = world.column(x, z);
      const depth = Math.max(1, Math.round((r + 0.5 - d) * 1.3));
      for (let y = floor - depth; y <= floor; y++) world.set(x, y, z, y === floor ? (Math.round(d) % 3 === 0 ? Block.Stone : Block.DeepStone) : Block.Stone);
      if (d > r - 0.5) world.set(x, floor + 1, z, Block.Cobble);
      world.topY[i] = floor;
      world.edgeDistance[i] = r - d;
      world.biome[i] = Biome.Rift;
    }
  }
  for (const [px, pz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
    const x = cx + Math.round(px * (r - 1.5) * 0.7071);
    const z = cz + Math.round(pz * (r - 1.5) * 0.7071);
    for (let y = floor + 1; y <= floor + 3; y++) world.set(x, y, z, Block.DeepStone);
    world.set(x, floor + 4, z, Block.Window);
  }
  return { x: cx, y: floor + 0.5, z: cz };
}

/** Six glowing standing stones around the gathering circle beside Seer Ilka. */
function buildRiftCircle(world: VoxelWorld): void {
  const { x: cx, z: cz, radius } = RIFT.circle;
  for (let k = 0; k < 6; k++) {
    const a = (k * Math.PI) / 3;
    const x = Math.round(cx + Math.cos(a) * (radius + 0.8));
    const z = Math.round(cz + Math.sin(a) * (radius + 0.8));
    const top = world.topY[world.column(x, z)]!;
    world.set(x, top + 1, z, Block.Stone);
    world.set(x, top + 2, z, Block.Window);
  }
}
