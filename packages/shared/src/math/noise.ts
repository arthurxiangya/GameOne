import { hash3 } from './random';

const fade = (t: number): number => t * t * (3 - 2 * t);

/** Seeded 2D value noise with fractal (fBm) layering. */
export class ValueNoise {
  constructor(private readonly seed: number) {}

  hash(x: number, y: number, k: number): number {
    return hash3(this.seed, x, y, k);
  }

  sample(x: number, z: number, k: number): number {
    const xi = Math.floor(x);
    const zi = Math.floor(z);
    const u = fade(x - xi);
    const v = fade(z - zi);
    const a = this.hash(xi, zi, k);
    const b = this.hash(xi + 1, zi, k);
    const c = this.hash(xi, zi + 1, k);
    const d = this.hash(xi + 1, zi + 1, k);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }

  /** Three octaves, roughly in [0, 1]. */
  fbm(x: number, z: number, k: number): number {
    return (
      this.sample(x, z, k) * 0.57 +
      this.sample(x * 2.03 + 11.3, z * 2.03 - 7.1, k + 1) * 0.29 +
      this.sample(x * 4.1 - 3.7, z * 4.1 + 5.2, k + 2) * 0.14
    );
  }
}
