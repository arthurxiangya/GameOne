import type * as THREE from 'three';
import { clamp, lerpAngle, type Vec3, type VoxelWorld } from '@lanternwood/shared';

/** Third-person follow camera with terrain collision, plus the slow orbit used on the title screen. */
export class CameraRig {
  yaw = 0;
  pitch = 0.42;
  distance = 9;
  shake = 0;
  private smoothed = 9;
  private orbitAngle = 0.6;

  constructor(private readonly camera: THREE.PerspectiveCamera) {}

  rotate(dx: number, dy: number): void {
    this.yaw -= dx * 0.0075;
    this.pitch = clamp(this.pitch + dy * 0.005, -0.15, 1.3);
  }

  zoom(factor: number): void {
    this.distance = clamp(this.distance * factor, 3.5, 20);
  }

  /** Swings the camera gently behind the hero while they run forward on a touch screen. */
  ease(towardYaw: number, amount: number): void {
    this.yaw = lerpAngle(this.yaw, towardYaw, amount);
  }

  orbit(dt: number): void {
    this.orbitAngle += dt * 0.045;
    const r = this.camera.aspect < 1 ? 100 : 120;
    this.camera.position.set(Math.sin(this.orbitAngle) * r, 62, Math.cos(this.orbitAngle) * r);
    this.camera.lookAt(0, 8, 0);
  }

  follow(target: Readonly<Vec3>, world: VoxelWorld, dt: number): void {
    const tx = target.x;
    const ty = target.y + 1.35;
    const tz = target.z;
    const cp = Math.cos(this.pitch);
    const dx = Math.sin(this.yaw) * cp;
    const dy = Math.sin(this.pitch);
    const dz = Math.cos(this.yaw) * cp;
    // Pull the camera in front of any block between it and the hero.
    let wanted = this.distance;
    for (let s = 0.5; s <= this.distance; s += 0.25) {
      if (world.isSolid(Math.round(tx + dx * s), Math.round(ty + dy * s), Math.round(tz + dz * s))) {
        wanted = Math.max(0.7, s - 0.4);
        break;
      }
    }
    this.smoothed = wanted < this.smoothed ? wanted : this.smoothed + (wanted - this.smoothed) * Math.min(1, dt * 5);
    this.camera.position.set(tx + dx * this.smoothed, ty + dy * this.smoothed, tz + dz * this.smoothed);
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt);
      this.camera.position.x += (Math.random() - 0.5) * this.shake;
      this.camera.position.y += (Math.random() - 0.5) * this.shake;
    }
    this.camera.lookAt(tx, ty, tz);
  }
}
