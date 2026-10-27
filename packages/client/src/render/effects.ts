import * as THREE from 'three';
import { easeOutCubic, lerp, type Vec3 } from '@lanternwood/shared';

type Effect = (dt: number) => boolean;

/** Short-lived visual effects: rings, level-up pillars, bolts and the boss slam warning. */
export class Effects {
  private readonly active: Effect[] = [];
  private readonly ring = new THREE.RingGeometry(0.86, 1, 56).rotateX(-Math.PI / 2);
  private readonly disc = new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2);
  private readonly pillar = new THREE.CylinderGeometry(1, 1, 1, 28, 1, true);
  private readonly gem = new THREE.OctahedronGeometry(0.24, 0);
  private readonly boltMaterial = new THREE.MeshBasicMaterial({ color: 0xffc066 });

  constructor(private readonly scene: THREE.Scene) {}

  update(dt: number): void {
    for (let i = this.active.length - 1; i >= 0; i--) if (!this.active[i]!(dt)) this.active.splice(i, 1);
  }

  ringPulse(at: Readonly<Vec3>, color: number, from: number, to: number, seconds: number, opacity = 0.9): void {
    const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(this.ring, material);
    mesh.position.set(at.x, at.y, at.z);
    this.scene.add(mesh);
    let t = 0;
    this.active.push((dt) => {
      t += dt;
      const p = Math.min(1, t / seconds);
      mesh.scale.setScalar(lerp(from, to, easeOutCubic(p)));
      material.opacity = opacity * (1 - p);
      if (p < 1) return true;
      this.scene.remove(mesh);
      material.dispose();
      return false;
    });
  }

  levelUp(at: Readonly<Vec3>): void {
    const material = new THREE.MeshBasicMaterial({ color: 0xffcf6a, transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(this.pillar, material);
    this.scene.add(mesh);
    let t = 0;
    this.active.push((dt) => {
      t += dt;
      const p = Math.min(1, t / 1.3);
      mesh.scale.set(0.9 + p * 0.5, 0.1 + easeOutCubic(p) * 9, 0.9 + p * 0.5);
      mesh.position.set(at.x, at.y + mesh.scale.y / 2, at.z);
      material.opacity = 0.7 * (1 - p);
      if (p < 1) return true;
      this.scene.remove(mesh);
      material.dispose();
      return false;
    });
  }

  /** A bolt flying from one moving point to another over `seconds`. */
  bolt(from: () => Vec3 | null, to: () => Vec3 | null, seconds: number): void {
    const start = from();
    if (!start) return;
    const mesh = new THREE.Mesh(this.gem, this.boltMaterial);
    mesh.position.set(start.x, start.y, start.z);
    this.scene.add(mesh);
    let t = 0;
    const duration = Math.max(0.08, seconds);
    this.active.push((dt) => {
      t += dt;
      const target = to();
      const origin = from() ?? start;
      if (!target || t >= duration) {
        this.scene.remove(mesh);
        if (target) this.ringPulse(target, 0xff9a3c, 0.2, 1.2, 0.3);
        return false;
      }
      const p = t / duration;
      mesh.position.set(lerp(origin.x, target.x, p), lerp(origin.y, target.y, p), lerp(origin.z, target.z, p));
      mesh.rotation.y += dt * 12;
      mesh.rotation.x += dt * 8;
      return true;
    });
  }

  /** Pulsing red disc where the boss is about to slam. */
  slamWarning(at: Readonly<Vec3>, radius: number, seconds: number): void {
    const material = new THREE.MeshBasicMaterial({ color: 0xff4b3a, transparent: true, opacity: 0.25, depthWrite: false });
    const mesh = new THREE.Mesh(this.disc, material);
    mesh.position.set(at.x, at.y + 0.12, at.z);
    mesh.scale.setScalar(radius);
    this.scene.add(mesh);
    let t = 0;
    this.active.push((dt) => {
      t += dt;
      material.opacity = 0.18 + 0.25 * Math.abs(Math.sin(t * 9));
      if (t < seconds) return true;
      this.scene.remove(mesh);
      material.dispose();
      return false;
    });
  }
}
