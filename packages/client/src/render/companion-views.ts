import type * as THREE from 'three';
import { damp, lerp, lerpAngle, type MountId, type PetId, type Vec3 } from '@lanternwood/shared';
import { buildMount, buildPet, type MountRig, type PetRig } from './companion-models';

interface Owner {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
}

interface Companions {
  mountId: MountId | null;
  mount: MountRig | null;
  petId: PetId | null;
  pet: PetRig | null;
  readonly petPos: Vec3;
  petYaw: number;
  petWalk: number;
  mountWalk: number;
  lastX: number;
  lastZ: number;
  speed: number;
}

/** Pets trail this far behind and to the left of their hero. */
const PET_BEHIND = 1.3;
const PET_SIDE = 0.8;
/** Further than this and the pet catches up instantly (respawn, teleport). */
const PET_SNAP = 16;

/**
 * Mounts and pets. Both are purely visual on every client: the server only says which mount a
 * hero rides and which pet follows them. Mounts carry their rider; pets trail behind, so they
 * cost the server nothing to simulate and almost nothing to send.
 */
export class CompanionViews {
  private readonly byOwner = new Map<number, Companions>();

  constructor(private readonly scene: THREE.Scene) {}

  /** Places one hero's mount and pet; returns how far to lift the rider (0 on foot). */
  update(id: number, owner: Owner, mount: MountId | null, pet: PetId | null, hidden: boolean, dt: number, now: number): number {
    let c = this.byOwner.get(id);
    if (!c) {
      if (!mount && !pet) return 0;
      c = { mountId: null, mount: null, petId: null, pet: null, petPos: { ...owner }, petYaw: owner.yaw, petWalk: 0, mountWalk: 0, lastX: owner.x, lastZ: owner.z, speed: 0 };
      this.byOwner.set(id, c);
    }
    const moved = Math.hypot(owner.x - c.lastX, owner.z - c.lastZ);
    c.lastX = owner.x;
    c.lastZ = owner.z;
    c.speed = lerp(c.speed, Math.min(16, moved / Math.max(dt, 1e-3)), damp(10, dt));

    if (hidden) mount = null;
    if (mount !== c.mountId) {
      if (c.mount) this.scene.remove(c.mount.root);
      c.mount = mount ? buildMount(mount) : null;
      c.mountId = mount;
      if (c.mount) this.scene.add(c.mount.root);
    }
    if (pet !== c.petId) {
      if (c.pet) this.scene.remove(c.pet.root);
      c.pet = pet ? buildPet(pet) : null;
      c.petId = pet;
      if (c.pet) {
        Object.assign(c.petPos, this.petTarget(owner));
        this.scene.add(c.pet.root);
      }
    }
    let lift = 0;
    if (c.mount) lift = this.animateMount(c, c.mount, owner, dt);
    if (c.pet) {
      c.pet.root.visible = !hidden;
      this.animatePet(c, c.pet, owner, dt, now);
    }
    if (!c.mount && !c.pet) this.remove(id);
    return lift;
  }

  remove(id: number): void {
    const c = this.byOwner.get(id);
    if (!c) return;
    if (c.mount) this.scene.remove(c.mount.root);
    if (c.pet) this.scene.remove(c.pet.root);
    this.byOwner.delete(id);
  }

  clear(): void {
    for (const id of [...this.byOwner.keys()]) this.remove(id);
  }

  private animateMount(c: Companions, rig: MountRig, owner: Owner, dt: number): number {
    rig.root.position.set(owner.x, owner.y, owner.z);
    rig.root.rotation.y = lerpAngle(rig.root.rotation.y, owner.yaw, damp(14, dt));
    const moving = c.speed > 0.4;
    c.mountWalk += dt * c.speed * 1.6;
    rig.legs.forEach((leg, i) => {
      const phase = i === 0 || i === 3 ? 0 : Math.PI;
      leg.rotation.x = moving ? Math.sin(c.mountWalk * 2 + phase) * 0.7 : lerp(leg.rotation.x, 0, damp(10, dt));
    });
    rig.body.position.y = moving ? Math.abs(Math.sin(c.mountWalk * 2)) * 0.06 : 0;
    return rig.saddle + rig.body.position.y;
  }

  private petTarget(owner: Owner): Vec3 {
    const fx = Math.sin(owner.yaw);
    const fz = Math.cos(owner.yaw);
    return { x: owner.x - fx * PET_BEHIND + fz * PET_SIDE, y: owner.y, z: owner.z - fz * PET_BEHIND - fx * PET_SIDE };
  }

  private animatePet(c: Companions, rig: PetRig, owner: Owner, dt: number, now: number): void {
    const target = this.petTarget(owner);
    const p = c.petPos;
    const gap = Math.hypot(target.x - p.x, target.z - p.z);
    if (gap > PET_SNAP) Object.assign(p, target);
    const k = damp(gap > 3 ? 6 : 3, dt);
    const before = { x: p.x, z: p.z };
    p.x = lerp(p.x, target.x, k);
    p.z = lerp(p.z, target.z, k);
    p.y = lerp(p.y, target.y, damp(8, dt));
    const step = Math.hypot(p.x - before.x, p.z - before.z);
    const moving = step / Math.max(dt, 1e-3) > 0.3;
    if (moving) c.petYaw = lerpAngle(c.petYaw, Math.atan2(p.x - before.x, p.z - before.z), damp(10, dt));
    else c.petYaw = lerpAngle(c.petYaw, owner.yaw, damp(2, dt));
    c.petWalk += step * 3.2;
    rig.root.position.set(p.x, p.y, p.z);
    rig.root.rotation.y = c.petYaw;
    if (rig.float) rig.body.position.y = Math.sin(now * 2.4 + owner.x) * 0.08;
    else if (rig.hop) rig.body.position.y = moving ? Math.abs(Math.sin(c.petWalk * 1.6)) * 0.25 : 0;
    rig.legs.forEach((leg, i) => {
      if (rig.splay) leg.rotation.y = moving ? Math.sin(c.petWalk * 3 + i) * 0.5 : 0;
      else leg.rotation.x = moving ? Math.sin(c.petWalk * 2 + (i === 0 || i === 3 ? 0 : Math.PI)) * 0.7 : 0;
    });
  }
}
