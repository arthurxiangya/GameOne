import { hash3 } from '../math/random';
import { BLOCK_COLOR, Block, isGlowBlock, isSolidBlock, type BlockId } from './blocks';
import { WORLD, type VoxelWorld } from './voxel-world';

export interface MeshBuffers {
  readonly vertexCount: number;
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  /** Per-vertex colour in sRGB, already multiplied by face shading and ambient occlusion. */
  readonly colors: Float32Array;
  readonly indices: Uint16Array | Uint32Array;
}

export interface ChunkMesh {
  readonly solid: MeshBuffers;
  readonly water: MeshBuffers;
  readonly glow: MeshBuffers;
}

interface Face {
  readonly n: readonly [number, number, number];
  readonly u: readonly [number, number, number];
  readonly v: readonly [number, number, number];
  /** Static directional shading so faces read even without lighting. */
  readonly shade: number;
}

// For each face u x v = n, so corners listed (-,-) (+,-) (+,+) (-,+) wind counter-clockwise from outside.
const FACES: readonly Face[] = [
  { n: [1, 0, 0], u: [0, 1, 0], v: [0, 0, 1], shade: 0.86 },
  { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0], shade: 0.86 },
  { n: [0, 1, 0], u: [0, 0, 1], v: [1, 0, 0], shade: 1 },
  { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1], shade: 0.7 },
  { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0], shade: 0.93 },
  { n: [0, 0, -1], u: [0, 1, 0], v: [1, 0, 0], shade: 0.93 },
];
const DOWN = 3;
const CORNERS: readonly (readonly [number, number])[] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
const AO_LEVELS = [0.5, 0.68, 0.85, 1] as const;

const RGB: readonly (readonly [number, number, number])[] = (() => {
  const out: [number, number, number][] = [];
  for (const id of Object.values(Block)) {
    const hex = BLOCK_COLOR[id as BlockId];
    out[id] = [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
  }
  return out;
})();

class MeshBuilder {
  private readonly p: number[] = [];
  private readonly n: number[] = [];
  private readonly c: number[] = [];
  private readonly i: number[] = [];

  get vertexCount(): number {
    return this.p.length / 3;
  }

  quad(world: VoxelWorld, x: number, y: number, z: number, face: Face, id: number, occlusion: boolean): void {
    const rgb = RGB[id] ?? RGB[Block.Stone]!;
    const variation = (1 + (hash3(0, x * 7 + y, z * 13 - y * 3, 77) - 0.5) * 0.1) * (occlusion ? face.shade : 1);
    const base = this.vertexCount;
    const ax = x + face.n[0];
    const ay = y + face.n[1];
    const az = z + face.n[2];
    const ao = [3, 3, 3, 3];
    for (let k = 0; k < 4; k++) {
      const [cu, cv] = CORNERS[k]!;
      this.p.push(
        x + face.n[0] * 0.5 + (face.u[0] * cu + face.v[0] * cv) * 0.5,
        y + face.n[1] * 0.5 + (face.u[1] * cu + face.v[1] * cv) * 0.5,
        z + face.n[2] * 0.5 + (face.u[2] * cu + face.v[2] * cv) * 0.5,
      );
      this.n.push(face.n[0], face.n[1], face.n[2]);
      if (occlusion) {
        const s1 = isSolidBlock(world.get(ax + face.u[0] * cu, ay + face.u[1] * cu, az + face.u[2] * cu)) ? 1 : 0;
        const s2 = isSolidBlock(world.get(ax + face.v[0] * cv, ay + face.v[1] * cv, az + face.v[2] * cv)) ? 1 : 0;
        const corner = isSolidBlock(
          world.get(ax + face.u[0] * cu + face.v[0] * cv, ay + face.u[1] * cu + face.v[1] * cv, az + face.u[2] * cu + face.v[2] * cv),
        ) ? 1 : 0;
        ao[k] = s1 && s2 ? 0 : 3 - s1 - s2 - corner;
      }
      const light = AO_LEVELS[ao[k] as 0 | 1 | 2 | 3] * variation;
      this.c.push(rgb[0] * light, rgb[1] * light, rgb[2] * light);
    }
    // Split the quad along the brighter diagonal to avoid AO artefacts.
    if (ao[0]! + ao[2]! >= ao[1]! + ao[3]!) this.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
    else this.i.push(base + 1, base + 2, base + 3, base + 1, base + 3, base);
  }

  build(): MeshBuffers {
    const vertexCount = this.vertexCount;
    return {
      vertexCount,
      positions: new Float32Array(this.p),
      normals: new Float32Array(this.n),
      colors: new Float32Array(this.c),
      indices: vertexCount > 65535 ? new Uint32Array(this.i) : new Uint16Array(this.i),
    };
  }
}

/**
 * Builds render geometry for one 16x16 column chunk. Only faces touching air (or water,
 * for solid blocks) are emitted, and bottoms below y = 0 are skipped because nobody sees
 * the underside of the island from up close.
 */
export function buildChunkMesh(world: VoxelWorld, cx: number, cz: number): ChunkMesh {
  const solid = new MeshBuilder();
  const water = new MeshBuilder();
  const glow = new MeshBuilder();
  const x0 = cx * WORLD.chunkSize + world.minX;
  const z0 = cz * WORLD.chunkSize + world.minZ;
  for (let x = x0; x < x0 + WORLD.chunkSize; x++) {
    for (let z = z0; z < z0 + WORLD.chunkSize; z++) {
      const col = world.column(x, z);
      const lo = world.colLo[col]!;
      const hi = world.colHi[col]!;
      for (let y = lo; y <= hi; y++) {
        const id = world.getInColumn(col, y);
        if (id === Block.Air) continue;
        const isWater = id === Block.Water;
        const isGlow = isGlowBlock(id);
        for (let f = 0; f < FACES.length; f++) {
          if (f === DOWN && (isWater || y < 0)) continue;
          const face = FACES[f]!;
          const neighbour = world.get(x + face.n[0], y + face.n[1], z + face.n[2]);
          if (isWater ? neighbour !== Block.Air : isSolidBlock(neighbour)) continue;
          const target = isWater ? water : isGlow ? glow : solid;
          target.quad(world, x, y, z, face, id, !isWater && !isGlow);
        }
      }
    }
  }
  return { solid: solid.build(), water: water.build(), glow: glow.build() };
}
