import type { MonsterType } from '../game/monsters';
import { ValueNoise } from '../math/noise';
import { Mulberry32, type RandomSource } from '../math/random';
import { clamp, lerp, smoothstep } from '../math/scalar';
import type { Vec3 } from '../math/vec';
import { Biome } from './biomes';
import { Block } from './blocks';
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
  world.computeColumnExtents();

  return {
    seed,
    world,
    monsterSpawns: placeMonsters(world, rng),
    lampPoints,
    waterfalls: findWaterfalls(world),
    playerSpawn: { x: 0, y: TOWN_Y + 0.5, z: 5 },
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
