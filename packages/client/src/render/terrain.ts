import * as THREE from 'three';
import { WORLD, buildChunkMesh, easeOutCubic, type GeneratedWorld, type MeshBuffers } from '@lanternwood/shared';
import { linearizeColors } from './color';

interface ChunkView {
  readonly group: THREE.Group;
  readonly x: number;
  readonly z: number;
  readonly born: number;
}

const RISE_SECONDS = 1.3;
const RISE_DEPTH = 45;

/**
 * Turns the shared voxel world into GPU meshes, a few chunks per frame so the page stays
 * responsive. Chunks rise into place as they are built, and far chunks are hidden.
 */
export class TerrainRenderer {
  private readonly solid = new THREE.MeshLambertMaterial({ vertexColors: true });
  private readonly water = new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.78, depthWrite: false });
  private readonly glow = new THREE.MeshBasicMaterial({ vertexColors: true });
  private readonly dot = makeDotTexture();
  private chunks: ChunkView[] = [];
  private queue: { cx: number; cz: number }[] = [];
  private total = 1;
  private generated: GeneratedWorld | null = null;
  private lampGlow: THREE.Points | null = null;
  private falls: { points: THREE.Points; positions: Float32Array; velocities: Float32Array } | null = null;

  constructor(private readonly scene: THREE.Scene, private readonly reduceMotion: boolean) {}

  get progress(): number {
    return 1 - this.queue.length / this.total;
  }

  get ready(): boolean {
    return this.generated !== null && this.queue.length === 0;
  }

  get world(): GeneratedWorld | null {
    return this.generated;
  }

  /** Discards any current terrain and starts building `generated`. */
  load(generated: GeneratedWorld): void {
    for (const c of this.chunks) {
      this.scene.remove(c.group);
      c.group.traverse((o: THREE.Object3D) => {
        if (o instanceof THREE.Mesh) o.geometry.dispose();
      });
    }
    this.chunks = [];
    this.generated = generated;
    const order: { cx: number; cz: number; d: number }[] = [];
    const size = WORLD.chunkSize;
    for (let cx = 0; cx < generated.world.chunksX; cx++) {
      for (let cz = 0; cz < generated.world.chunksZ; cz++) {
        order.push({ cx, cz, d: Math.hypot(cx * size + generated.world.minX + size / 2, cz * size + generated.world.minZ + size / 2) });
      }
    }
    order.sort((a, b) => a.d - b.d);
    this.queue = order;
    this.total = order.length;
    this.setupLampGlow(generated);
    this.setupWaterfalls(generated);
  }

  /** Builds chunks until `budgetMs` is used up. */
  buildSome(budgetMs: number, now: number): void {
    const world = this.generated?.world;
    if (!world) return;
    const start = performance.now();
    while (this.queue.length > 0 && performance.now() - start < budgetMs) {
      const { cx, cz } = this.queue.shift()!;
      const mesh = buildChunkMesh(world, cx, cz);
      const group = new THREE.Group();
      if (mesh.solid.vertexCount > 0) {
        const m = new THREE.Mesh(toGeometry(mesh.solid), this.solid);
        m.castShadow = true;
        m.receiveShadow = true;
        group.add(m);
      }
      if (mesh.water.vertexCount > 0) {
        const m = new THREE.Mesh(toGeometry(mesh.water), this.water);
        m.position.y = -0.12;
        m.receiveShadow = true;
        m.renderOrder = 1;
        group.add(m);
      }
      if (mesh.glow.vertexCount > 0) group.add(new THREE.Mesh(toGeometry(mesh.glow), this.glow));
      group.position.y = this.reduceMotion ? 0 : -RISE_DEPTH;
      this.scene.add(group);
      const size = WORLD.chunkSize;
      this.chunks.push({ group, x: cx * size + world.minX + size / 2, z: cz * size + world.minZ + size / 2, born: now });
    }
  }

  /** `lit` dims the lamp glow (0 when the Great Lantern has gone dark on a lost Lantern Night). */
  update(now: number, dt: number, camera: THREE.Camera, drawDistance: number, night: number, lit = 1): void {
    for (const c of this.chunks) {
      const p = (now - c.born) / RISE_SECONDS;
      c.group.position.y = p < 1 && !this.reduceMotion ? -RISE_DEPTH * (1 - easeOutCubic(Math.max(0, p))) : 0;
      c.group.visible = Math.hypot(camera.position.x - c.x, camera.position.z - c.z) < drawDistance + 16;
    }
    this.glow.color.setScalar(0.72 + 0.28 * night);
    if (this.lampGlow) (this.lampGlow.material as THREE.PointsMaterial).opacity = 0.75 * night * (0.15 + 0.85 * lit);
    this.stepWaterfalls(dt);
  }

  private setupLampGlow(generated: GeneratedWorld): void {
    if (this.lampGlow) this.scene.remove(this.lampGlow);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(generated.lampPoints.flatMap((p) => [p.x, p.y, p.z]), 3));
    this.lampGlow = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({ color: 0xffb04a, size: 3.6, map: this.dot, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    this.lampGlow.frustumCulled = false;
    this.scene.add(this.lampGlow);
  }

  private setupWaterfalls(generated: GeneratedWorld): void {
    if (this.falls) this.scene.remove(this.falls.points);
    this.falls = null;
    if (generated.waterfalls.length === 0) return;
    const count = generated.waterfalls.length * 140;
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const points = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({ color: 0xb4dcfb, size: 0.5, map: this.dot, transparent: true, opacity: 0.85, depthWrite: false }),
    );
    points.frustumCulled = false;
    this.scene.add(points);
    this.falls = { points, positions, velocities };
    for (let i = 0; i < count; i++) this.spawnDrop(i, Math.random() * 3);
  }

  private spawnDrop(i: number, age: number): void {
    const falls = this.falls;
    const sources = this.generated?.waterfalls;
    if (!falls || !sources || sources.length === 0) return;
    const per = falls.positions.length / 3 / sources.length;
    const f = sources[Math.min(sources.length - 1, Math.floor(i / per))]!;
    const out = 0.9 + Math.random() * 0.7;
    const side = (Math.random() - 0.5) * 0.9;
    const vx = f.dx * out;
    const vz = f.dz * out;
    const vy = Math.random() * 0.3;
    const k = i * 3;
    falls.positions[k] = f.x + f.dz * side + vx * age;
    falls.positions[k + 1] = WORLD.waterLevel + 0.3 + vy * age - 4.9 * age * age;
    falls.positions[k + 2] = f.z + f.dx * side + vz * age;
    falls.velocities[k] = vx;
    falls.velocities[k + 1] = vy - 9.8 * age;
    falls.velocities[k + 2] = vz;
  }

  private stepWaterfalls(dt: number): void {
    const falls = this.falls;
    if (!falls) return;
    const { positions: p, velocities: v } = falls;
    for (let i = 0; i < p.length / 3; i++) {
      const k = i * 3;
      v[k + 1] -= 9.8 * dt;
      p[k] += v[k] * dt;
      p[k + 1] += v[k + 1] * dt;
      p[k + 2] += v[k + 2] * dt;
      if (p[k + 1] < -30) this.spawnDrop(i, Math.random() * 0.05);
    }
    falls.points.geometry.attributes.position.needsUpdate = true;
  }
}

function toGeometry(buffers: MeshBuffers): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(buffers.positions, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(buffers.normals, 3));
  g.setAttribute('color', new THREE.BufferAttribute(linearizeColors(buffers.colors), 3));
  g.setIndex(new THREE.BufferAttribute(buffers.indices, 1));
  g.computeBoundingSphere();
  return g;
}

export function makeDotTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const g = canvas.getContext('2d');
  if (g) {
    const gradient = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.35, 'rgba(255,255,255,.85)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gradient;
    g.fillRect(0, 0, 64, 64);
  }
  return new THREE.CanvasTexture(canvas);
}
