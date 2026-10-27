/** Source of uniform random numbers in [0, 1). Injected so simulations stay testable. */
export interface RandomSource {
  next(): number;
}

/** Stateless integer hash of (x, y, k) mixed with a seed, mapped to [0, 1). */
export function hash3(seed: number, x: number, y: number, k: number): number {
  let h = Math.imul((x | 0) ^ 0x27d4eb2d, 374761393);
  h ^= Math.imul((y | 0) + 0x165667b1, 668265263);
  h ^= Math.imul((k | 0) + 0x5bd1e995, 1274126177);
  h ^= seed | 0;
  h = Math.imul(h ^ (h >>> 15), 2246822519);
  h = Math.imul(h ^ (h >>> 13), 3266489917);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Small, fast, seedable PRNG (Mulberry32). Deterministic across Node and browsers. */
export class Mulberry32 implements RandomSource {
  private state: number;

  constructor(seed: number) {
    this.state = seed | 0;
  }

  next(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
}
