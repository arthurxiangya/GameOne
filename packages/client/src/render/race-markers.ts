import * as THREE from 'three';
import { CHECKPOINT_RADIUS, coursePoints, type RaceCourse } from '@lanternwood/shared';

interface Marker {
  readonly group: THREE.Group;
  readonly beam: THREE.MeshBasicMaterial;
  readonly ring: THREE.MeshBasicMaterial;
}

const BEAM_HEIGHT = 34;
const NEXT = 0xffd27a;
const LATER = 0xff9a3c;

/**
 * Ember Run checkpoints: a tall column of light with a ring on the ground, one per course point.
 * Shown only while racing; the next point glows brightly, the ones after it faintly, and
 * passed ones disappear. The last point is the start line again, as the finish.
 */
export class RaceMarkers {
  private readonly markers: Marker[] = [];
  private readonly beamGeometry = new THREE.CylinderGeometry(0.7, 0.7, BEAM_HEIGHT, 12, 1, true);
  private readonly ringGeometry = new THREE.RingGeometry(CHECKPOINT_RADIUS - 0.35, CHECKPOINT_RADIUS, 40);

  constructor(private readonly scene: THREE.Scene) {}

  load(course: RaceCourse): void {
    this.clear();
    // The start line doubles as the finish, so it gets one marker: index 0 and the last index share it.
    for (const p of coursePoints(course).slice(0, -1)) {
      const group = new THREE.Group();
      const beam = new THREE.MeshBasicMaterial({ color: LATER, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
      const ring = new THREE.MeshBasicMaterial({ color: LATER, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
      const beamMesh = new THREE.Mesh(this.beamGeometry, beam);
      beamMesh.position.y = BEAM_HEIGHT / 2 - 0.4;
      const ringMesh = new THREE.Mesh(this.ringGeometry, ring);
      ringMesh.rotation.x = -Math.PI / 2;
      ringMesh.position.y = 0.06;
      group.add(beamMesh, ringMesh);
      group.position.set(p.x, p.y - 0.5, p.z);
      group.visible = false;
      this.scene.add(group);
      this.markers.push({ group, beam, ring });
    }
  }

  /** `next` is the course index of the next point to reach, or null when not racing. */
  update(next: number | null, now: number): void {
    const last = this.markers.length;
    this.markers.forEach((m, i) => {
      // The finish (index `last`) lights up the start marker again.
      const index = i === 0 ? last : i;
      const show = next !== null && index >= next;
      m.group.visible = show;
      if (!show) return;
      const isNext = index === next;
      const pulse = isNext ? 0.12 * Math.sin(now * 4) : 0;
      m.beam.color.setHex(isNext ? NEXT : LATER);
      m.ring.color.setHex(isNext ? NEXT : LATER);
      m.beam.opacity = isNext ? 0.42 + pulse : 0.1;
      m.ring.opacity = isNext ? 0.75 + pulse : 0.2;
    });
  }

  clear(): void {
    for (const m of this.markers) this.scene.remove(m.group);
    this.markers.length = 0;
  }
}
