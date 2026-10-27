/**
 * Uniform grid over the XZ plane. Rebuilt every tick, it turns "who is near (x, z)?"
 * from a scan of every entity into a look at a handful of cells.
 */
export class SpatialHash<T> {
  private readonly cells = new Map<number, T[]>();

  constructor(
    private readonly cellSize: number,
    private readonly getX: (item: T) => number,
    private readonly getZ: (item: T) => number,
  ) {}

  rebuild(items: Iterable<T>): void {
    this.cells.clear();
    for (const item of items) {
      const key = this.key(Math.floor(this.getX(item) / this.cellSize), Math.floor(this.getZ(item) / this.cellSize));
      const cell = this.cells.get(key);
      if (cell) cell.push(item);
      else this.cells.set(key, [item]);
    }
  }

  /** Items whose position lies within `radius` of (x, z). */
  query(x: number, z: number, radius: number): T[] {
    const out: T[] = [];
    const r2 = radius * radius;
    const x0 = Math.floor((x - radius) / this.cellSize);
    const x1 = Math.floor((x + radius) / this.cellSize);
    const z0 = Math.floor((z - radius) / this.cellSize);
    const z1 = Math.floor((z + radius) / this.cellSize);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const cell = this.cells.get(this.key(cx, cz));
        if (!cell) continue;
        for (const item of cell) {
          const dx = this.getX(item) - x;
          const dz = this.getZ(item) - z;
          if (dx * dx + dz * dz <= r2) out.push(item);
        }
      }
    }
    return out;
  }

  private key(cx: number, cz: number): number {
    return (cx + 32768) * 65536 + (cz + 32768);
  }
}
