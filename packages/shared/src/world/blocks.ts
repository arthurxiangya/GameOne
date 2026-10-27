/** Block registry. Ids are stored in a Uint8Array, so they must stay below 256. */
export const Block = {
  Air: 0,
  Grass: 1,
  Dirt: 2,
  Stone: 3,
  Sand: 4,
  Snow: 5,
  Water: 6,
  Wood: 7,
  LeafOrange: 8,
  LeafRed: 9,
  LeafGold: 10,
  LeafGreen: 11,
  Pine: 12,
  Cactus: 13,
  Plank: 14,
  RoofRed: 15,
  RoofTeal: 16,
  Cobble: 17,
  Path: 18,
  Lamp: 19,
  DeepStone: 20,
  ForestGrass: 21,
  Sandstone: 22,
  Window: 23,
  Marsh: 24,
} as const;

export type BlockId = (typeof Block)[keyof typeof Block];

/** Display colour of each block, as sRGB hex. */
export const BLOCK_COLOR: Readonly<Record<BlockId, number>> = {
  [Block.Air]: 0x000000,
  [Block.Grass]: 0x6aa45a,
  [Block.Dirt]: 0x8a5e3e,
  [Block.Stone]: 0x8f939c,
  [Block.Sand]: 0xdec48e,
  [Block.Snow]: 0xeef2f6,
  [Block.Water]: 0x3e94d6,
  [Block.Wood]: 0x6f4b2d,
  [Block.LeafOrange]: 0xe58a2e,
  [Block.LeafRed]: 0xc8543c,
  [Block.LeafGold]: 0xe6b840,
  [Block.LeafGreen]: 0x5f9e52,
  [Block.Pine]: 0x34684e,
  [Block.Cactus]: 0x568c4a,
  [Block.Plank]: 0xb28456,
  [Block.RoofRed]: 0xa83e34,
  [Block.RoofTeal]: 0x347880,
  [Block.Cobble]: 0x9e988c,
  [Block.Path]: 0xb08c60,
  [Block.Lamp]: 0xffd68a,
  [Block.DeepStone]: 0x5c6076,
  [Block.ForestGrass]: 0x548448,
  [Block.Sandstone]: 0xc8a870,
  [Block.Window]: 0xffc86e,
  [Block.Marsh]: 0x60906a,
};

/** Solid blocks collide and hide the faces of their neighbours. */
export const isSolidBlock = (id: number): boolean => id !== Block.Air && id !== Block.Water;

/** Glow blocks are drawn unlit so they read as light sources at night. */
export const isGlowBlock = (id: number): boolean => id === Block.Lamp || id === Block.Window;
