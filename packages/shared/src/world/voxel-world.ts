import { Biome } from './biomes';
import { Block, isSolidBlock } from './blocks';

export const WORLD = {
  width: 160,
  depth: 160,
  height: 72,
  /** Offsets that map world coordinates (which can be negative) to array indices. */
  originX: 80,
  originZ: 80,
  originY: 24,
  waterLevel: 9,
  townY: 12,
  chunkSize: 16,
} as const;

export const MIN_Y = -WORLD.originY;
export const MAX_Y = WORLD.height - WORLD.originY - 1;
export const NO_GROUND = -999;

const W = WORLD.width;
const D = WORLD.depth;
const H = WORLD.height;
const OX = WORLD.originX;
const OZ = WORLD.originZ;
const OY = WORLD.originY;

/**
 * Dense voxel storage plus per-column metadata. Coordinates are integer block
 * centres; a block at (x, y, z) occupies [x-0.5, x+0.5] on each axis.
 */
export class VoxelWorld {
  readonly blocks = new Uint8Array(W * D * H);
  /** Highest terrain block per column, or NO_GROUND outside the island. */
  readonly topY = new Int16Array(W * D).fill(NO_GROUND);
  readonly biome = new Uint8Array(W * D).fill(Biome.None);
  /** Distance (in blocks) from a column to the island rim. */
  readonly edgeDistance = new Float32Array(W * D);
  /** Lowest and highest occupied y per column; lo > hi means empty. */
  readonly colLo = new Int16Array(W * D).fill(1);
  readonly colHi = new Int16Array(W * D).fill(0);

  readonly minX = -OX;
  readonly maxX = W - OX - 1;
  readonly minZ = -OZ;
  readonly maxZ = D - OZ - 1;
  readonly chunksX = W / WORLD.chunkSize;
  readonly chunksZ = D / WORLD.chunkSize;

  inXZ(x: number, z: number): boolean {
    return x >= -OX && x < W - OX && z >= -OZ && z < D - OZ;
  }

  column(x: number, z: number): number {
    return (x + OX) * D + (z + OZ);
  }

  get(x: number, y: number, z: number): number {
    if (x < -OX || x >= W - OX || z < -OZ || z >= D - OZ || y < -OY || y >= H - OY) return Block.Air;
    return this.blocks[((x + OX) * D + (z + OZ)) * H + (y + OY)]!;
  }

  set(x: number, y: number, z: number, id: number): void {
    if (x < -OX || x >= W - OX || z < -OZ || z >= D - OZ || y < -OY || y >= H - OY) return;
    this.blocks[((x + OX) * D + (z + OZ)) * H + (y + OY)] = id;
  }

  /** Raw block lookup by column index and y, used by tight loops like the mesher. */
  getInColumn(column: number, y: number): number {
    return this.blocks[column * H + y + OY]!;
  }

  isSolid(x: number, y: number, z: number): boolean {
    return isSolidBlock(this.get(x, y, z));
  }

  /** Terrain height of the column under (x, z), or NO_GROUND. */
  groundTop(x: number, z: number): number {
    const xi = Math.round(x);
    const zi = Math.round(z);
    return this.inXZ(xi, zi) ? this.topY[this.column(xi, zi)]! : NO_GROUND;
  }

  /** Height that walking creatures stand on (water counts as a surface). */
  surfaceY(x: number, z: number): number {
    const top = this.groundTop(x, z);
    if (top === NO_GROUND) return NO_GROUND;
    return top < WORLD.waterLevel ? WORLD.waterLevel + 0.25 : top + 0.5;
  }

  biomeAt(x: number, z: number): number {
    const xi = Math.round(x);
    const zi = Math.round(z);
    return this.inXZ(xi, zi) ? this.biome[this.column(xi, zi)]! : Biome.None;
  }

  /** Recomputes colLo/colHi after generation; the mesher only scans that range. */
  computeColumnExtents(): void {
    for (let c = 0; c < W * D; c++) {
      const base = c * H;
      let lo = Number.POSITIVE_INFINITY;
      let hi = Number.NEGATIVE_INFINITY;
      for (let k = 0; k < H; k++) {
        if (this.blocks[base + k] !== Block.Air) {
          if (lo === Number.POSITIVE_INFINITY) lo = k - OY;
          hi = k - OY;
        }
      }
      if (lo !== Number.POSITIVE_INFINITY) {
        this.colLo[c] = lo;
        this.colHi[c] = hi;
      } else {
        this.colLo[c] = 1;
        this.colHi[c] = 0;
      }
    }
  }

  /** Visits every column of the world grid. */
  forEachColumn(fn: (x: number, z: number, column: number) => void): void {
    for (let x = -OX; x < W - OX; x++) {
      for (let z = -OZ; z < D - OZ; z++) fn(x, z, (x + OX) * D + (z + OZ));
    }
  }
}
