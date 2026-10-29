import * as THREE from 'three';
import type { VoxelWorld } from '@lanternwood/shared';

/** The glowing ring on the ground around a duel; leaving it forfeits. Drawn only for your own duel. */
export class DuelRing {
  private readonly material = new THREE.MeshBasicMaterial({
    color: 0xff8a2a, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  private readonly mesh: THREE.Mesh;
  private radius = 0;

  constructor(scene: THREE.Scene) {
    this.mesh = new THREE.Mesh(new THREE.RingGeometry(0.92, 1, 64), this.material);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  /** Shows the ring at (x, z), or hides it when `radius` is null. */
  update(world: VoxelWorld | null, x: number, z: number, radius: number | null, now: number): void {
    this.mesh.visible = radius !== null && world !== null;
    if (radius === null || !world) return;
    if (radius !== this.radius) {
      this.radius = radius;
      this.mesh.scale.setScalar(radius);
    }
    this.mesh.position.set(x, world.surfaceY(x, z) + 0.08, z);
    this.material.opacity = 0.55 + 0.15 * Math.sin(now * 3);
  }
}
