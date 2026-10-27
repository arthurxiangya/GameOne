import * as THREE from 'three';
import { NPCS, damp, lerp, lerpAngle, lookAt, type EntityState, type NpcDef, type Vec3, type VoxelWorld } from '@lanternwood/shared';
import { buildHero, buildMonster, buildNpc, type ModelRig } from './models';

interface View {
  readonly rig: ModelRig;
  readonly baseScale: number;
  walk: number;
  speed: number;
  lastX: number;
  lastZ: number;
  flash: number;
  swing: number;
  cast: number;
  attack: number;
  death: number | null;
}

export interface PoseInput {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
  readonly dead: boolean;
  readonly attacking: boolean;
}

interface NpcView {
  readonly npc: NpcDef;
  readonly rig: ModelRig;
  readonly y: number;
  yaw: number;
}

const SWING_SECONDS = 0.32;
const DEATH_SECONDS = 0.6;
const WINDUP_SECONDS = 0.38;

/** Owns the 3D models of every character and animates them from interpolated state. */
export class EntityViews {
  private readonly views = new Map<number, View>();
  private npcViews: NpcView[] = [];
  private heroId: number | null = null;
  private readonly scratch = new THREE.Vector3();

  constructor(private readonly scene: THREE.Scene) {}

  add(state: EntityState): void {
    if (this.views.has(state.id)) return;
    const rig = state.k === 'm' ? buildMonster(state.ty) : buildHero(lookAt(state.look), { lamp: true, blade: true });
    const baseScale = state.k === 'm' ? state.sc : 1;
    this.register(state.id, rig, baseScale, state.x, state.z);
  }

  addHero(id: number, look: number): void {
    this.remove(this.heroId ?? -1);
    this.heroId = id;
    this.register(id, buildHero(lookAt(look), { lamp: true, blade: true }), 1, 0, 0);
  }

  remove(id: number): void {
    const view = this.views.get(id);
    if (!view) return;
    this.scene.remove(view.rig.root);
    this.views.delete(id);
    if (id === this.heroId) this.heroId = null;
  }

  clear(): void {
    for (const id of [...this.views.keys()]) this.remove(id);
  }

  spawnNpcs(world: VoxelWorld): void {
    for (const v of this.npcViews) this.scene.remove(v.rig.root);
    this.npcViews = NPCS.map((npc) => {
      const rig = buildNpc(npc.id);
      const y = world.surfaceY(npc.x, npc.z);
      rig.root.position.set(npc.x, y, npc.z);
      rig.root.rotation.y = npc.yaw;
      this.scene.add(rig.root);
      return { npc, rig, y, yaw: npc.yaw };
    });
  }

  has(id: number): boolean {
    return this.views.has(id);
  }

  /** World position of an entity's chest, for effects and floating text. */
  positionOf(id: number, heightFraction = 0.55): Vec3 | null {
    const view = this.views.get(id);
    if (!view) return null;
    const p = view.rig.root.position;
    return { x: p.x, y: p.y + view.rig.height * view.baseScale * heightFraction, z: p.z };
  }

  /** Top of the head, for nameplates. */
  headOf(id: number): Vec3 | null {
    return this.positionOf(id, 1.08);
  }

  heroLampPosition(): Vec3 | null {
    const hero = this.heroId !== null ? this.views.get(this.heroId) : undefined;
    if (!hero?.rig.lamp) return null;
    hero.rig.lamp.getWorldPosition(this.scratch);
    return { x: this.scratch.x, y: this.scratch.y, z: this.scratch.z };
  }

  flash(id: number): void {
    const v = this.views.get(id);
    if (v) v.flash = 0.16;
  }

  swing(id: number): void {
    const v = this.views.get(id);
    if (v) v.swing = SWING_SECONDS;
  }

  cast(id: number): void {
    const v = this.views.get(id);
    if (v) v.cast = 0.4;
  }

  update(id: number, pose: PoseInput, dt: number, now: number): void {
    const v = this.views.get(id);
    if (!v) return;
    const { rig } = v;
    const moved = Math.hypot(pose.x - v.lastX, pose.z - v.lastZ);
    v.lastX = pose.x;
    v.lastZ = pose.z;
    v.speed = lerp(v.speed, Math.min(12, moved / Math.max(dt, 1e-3)), damp(10, dt));
    const moving = v.speed > 0.3;
    v.walk += dt * v.speed * 2.9;

    rig.root.position.set(pose.x, pose.y, pose.z);
    rig.root.rotation.y = lerpAngle(rig.root.rotation.y, pose.yaw, damp(14, dt));

    if (pose.dead) {
      v.death = (v.death ?? 0) + dt;
      const p = Math.min(1, v.death / DEATH_SECONDS);
      rig.root.scale.setScalar(v.baseScale * (1 - p * 0.85));
      rig.root.rotation.z = p * 1.2;
      rig.root.position.y -= p * 0.4;
      return;
    }
    if (v.death !== null) {
      v.death = null;
      rig.root.rotation.z = 0;
    }

    v.flash = Math.max(0, v.flash - dt);
    rig.root.scale.setScalar(v.baseScale * (1 + 0.9 * v.flash));

    v.attack = pose.attacking ? Math.min(WINDUP_SECONDS, v.attack + dt) : 0;
    const lunge = pose.attacking ? Math.sin((v.attack / WINDUP_SECONDS) * Math.PI) : 0;
    rig.body.position.z = lunge * 0.35;

    if (rig.hop) {
      rig.body.position.y = moving ? Math.abs(Math.sin(v.walk * 1.6)) * 0.35 : Math.abs(Math.sin(now * 2 + id)) * 0.04;
    } else {
      rig.body.position.y = rig.legs.length === 2 && !rig.arms.length ? Math.abs(Math.sin(v.walk)) * 0.06 * (moving ? 1 : 0) : 0;
    }
    rig.legs.forEach((leg, i) => {
      if (rig.splay) {
        leg.rotation.y = moving ? Math.sin(v.walk * 3 + i * 1.3) * 0.45 : 0;
      } else {
        const phase = rig.legs.length === 4 ? (i === 0 || i === 3 ? 0 : Math.PI) : i === 0 ? 0 : Math.PI;
        leg.rotation.x = moving ? Math.sin(v.walk * 2 + phase) * 0.6 : 0;
      }
    });
    if (rig.arms.length === 2) {
      const sway = moving ? Math.sin(v.walk * 2) * 0.5 : 0;
      rig.arms[0]!.rotation.x = pose.attacking ? -2.2 * lunge : sway;
      rig.arms[1]!.rotation.x = pose.attacking ? -2.2 * lunge : -sway;
    }

    if (rig.armR) {
      if (v.swing > 0) {
        v.swing = Math.max(0, v.swing - dt);
        const p = 1 - v.swing / SWING_SECONDS;
        rig.armR.rotation.x = p < 0.35 ? lerp(0, -2.3, p / 0.35) : lerp(-2.3, 0.5, (p - 0.35) / 0.65);
      } else {
        rig.armR.rotation.x = lerp(rig.armR.rotation.x, moving ? -Math.sin(v.walk) * 0.5 : 0, damp(14, dt));
      }
    }
    if (rig.armL) {
      if (v.cast > 0) {
        v.cast = Math.max(0, v.cast - dt);
        rig.armL.rotation.x = -1.6;
      } else {
        rig.armL.rotation.x = lerp(rig.armL.rotation.x, moving ? Math.sin(v.walk) * 0.5 : 0, damp(14, dt));
      }
    }
  }

  /** Townsfolk turn to face a nearby hero and breathe gently. */
  updateNpcs(focus: Readonly<Vec3> | null, dt: number, now: number): void {
    for (const v of this.npcViews) {
      const near = focus && Math.hypot(focus.x - v.npc.x, focus.z - v.npc.z) < 7;
      const want = near && focus ? Math.atan2(focus.x - v.npc.x, focus.z - v.npc.z) : v.npc.yaw;
      v.yaw = lerpAngle(v.yaw, want, damp(4, dt));
      v.rig.root.rotation.y = v.yaw;
      v.rig.body.position.y = Math.sin(now * 1.6 + v.npc.x) * 0.02;
    }
  }

  npcHead(index: number): Vec3 | null {
    const v = this.npcViews[index];
    return v ? { x: v.npc.x, y: v.y + 2.05, z: v.npc.z } : null;
  }

  private register(id: number, rig: ModelRig, baseScale: number, x: number, z: number): void {
    rig.root.scale.setScalar(baseScale);
    this.scene.add(rig.root);
    this.views.set(id, { rig, baseScale, walk: 0, speed: 0, lastX: x, lastZ: z, flash: 0, swing: 0, cast: 0, attack: 0, death: null });
  }
}
