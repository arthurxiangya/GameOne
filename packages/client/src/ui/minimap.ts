import { BLOCK_COLOR, NO_GROUND, WORLD, clamp, type BlockId, type Vec3, type VoxelWorld } from '@lanternwood/shared';
import { cssToken } from './dom';

export interface MapMarker {
  readonly x: number;
  readonly z: number;
  readonly kind: 'foe' | 'boss' | 'ally' | 'npc';
}

const PAD = 48;
/** Blocks visible across the minimap. */
const SPAN = 64;

/** North-up circular minimap rendered from a pre-baked terrain image. */
export class Minimap {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly terrain = document.createElement('canvas');
  private readonly colors = {
    foe: cssToken('--foe', '#ff8e7e'),
    ally: cssToken('--ally', '#a6d6ff'),
    npc: cssToken('--friend', '#ffd98a'),
    lantern: cssToken('--lantern', '#ffb04a'),
    ink: cssToken('--ink', '#f7f0e3'),
    bg: cssToken('--night', '#0c1222'),
  };
  private dpr = 1;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas is not available');
    this.ctx = ctx;
    this.resize();
  }

  resize(): void {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(112 * this.dpr);
    this.canvas.height = Math.round(112 * this.dpr);
  }

  /** Bakes one pixel per column: the colour of its top block, shaded by height and slope. */
  paint(world: VoxelWorld): void {
    this.terrain.width = WORLD.width + PAD * 2;
    this.terrain.height = WORLD.depth + PAD * 2;
    const g = this.terrain.getContext('2d');
    if (!g) return;
    const image = g.createImageData(this.terrain.width, this.terrain.height);
    world.forEachColumn((x, z, i) => {
      const top = world.topY[i]!;
      if (top === NO_GROUND) return;
      const id = world.getInColumn(i, world.colHi[i]!) as BlockId;
      const hex = BLOCK_COLOR[id] ?? BLOCK_COLOR[3];
      const nw = world.inXZ(x - 1, z - 1) ? world.topY[world.column(x - 1, z - 1)]! : top;
      const shade = clamp(0.78 + ((top - 8) / 34) * 0.3 + (nw === NO_GROUND ? 0 : (top - nw) * 0.06), 0.55, 1.25);
      const k = ((z - world.minZ + PAD) * this.terrain.width + (x - world.minX + PAD)) * 4;
      image.data[k] = Math.min(255, ((hex >> 16) & 255) * shade);
      image.data[k + 1] = Math.min(255, ((hex >> 8) & 255) * shade);
      image.data[k + 2] = Math.min(255, (hex & 255) * shade);
      image.data[k + 3] = 255;
    });
    g.putImageData(image, 0, 0);
  }

  draw(world: VoxelWorld, focus: Readonly<Vec3>, facing: number, markers: readonly MapMarker[], quest: { x: number; z: number } | null): void {
    const { ctx, colors } = this;
    const size = this.canvas.width;
    const scale = size / SPAN;
    const d = this.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = colors.bg;
    ctx.fillRect(0, 0, size, size);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.terrain, focus.x - world.minX + 0.5 + PAD - SPAN / 2, focus.z - world.minZ + 0.5 + PAD - SPAN / 2, SPAN, SPAN, 0, 0, size, size);

    const toMap = (x: number, z: number): [number, number] => [(x - focus.x) * scale + size / 2, (z - focus.z) * scale + size / 2];
    for (const m of markers) {
      const [px, pz] = toMap(m.x, m.z);
      if (Math.hypot(px - size / 2, pz - size / 2) > size / 2 - 2) continue;
      ctx.fillStyle = m.kind === 'boss' || m.kind === 'foe' ? colors.foe : colors[m.kind];
      ctx.beginPath();
      ctx.arc(px, pz, (m.kind === 'boss' ? 3.4 : m.kind === 'npc' ? 2.2 : 1.8) * d, 0, Math.PI * 2);
      ctx.fill();
    }

    if (quest) {
      let [qx, qz] = toMap(quest.x, quest.z);
      const dx = qx - size / 2;
      const dz = qz - size / 2;
      const dist = Math.hypot(dx, dz);
      const limit = size / 2 - 7 * d;
      ctx.save();
      ctx.fillStyle = colors.lantern;
      ctx.strokeStyle = colors.bg;
      ctx.lineWidth = 1.5 * d;
      if (dist > limit) {
        qx = size / 2 + (dx / dist) * limit;
        qz = size / 2 + (dz / dist) * limit;
        ctx.translate(qx, qz);
        ctx.rotate(Math.atan2(dz, dx));
        ctx.beginPath();
        ctx.moveTo(6 * d, 0);
        ctx.lineTo(-4 * d, -5 * d);
        ctx.lineTo(-4 * d, 5 * d);
        ctx.closePath();
      } else {
        ctx.translate(qx, qz);
        ctx.rotate(Math.PI / 4);
        ctx.beginPath();
        ctx.rect(-4 * d, -4 * d, 8 * d, 8 * d);
      }
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    ctx.save();
    ctx.translate(size / 2, size / 2);
    ctx.rotate(Math.atan2(Math.cos(facing), Math.sin(facing)));
    ctx.fillStyle = colors.ink;
    ctx.strokeStyle = colors.bg;
    ctx.lineWidth = 1.5 * d;
    ctx.beginPath();
    ctx.moveTo(7 * d, 0);
    ctx.lineTo(-5 * d, -4.5 * d);
    ctx.lineTo(-2.5 * d, 0);
    ctx.lineTo(-5 * d, 4.5 * d);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}
