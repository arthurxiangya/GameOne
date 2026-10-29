import * as THREE from 'three';
import type { MountId, PetId } from '@lanternwood/shared';
import { joint, part, type ModelRig } from './models';

/** A mount: its rig, and how high above the ground its rider sits. */
export interface MountRig extends ModelRig {
  readonly saddle: number;
}

interface Beast {
  readonly body: number;
  readonly belly: number;
  readonly legs: number;
  readonly head: number;
  readonly eye: number;
  readonly glowEyes?: boolean;
  /** Overall size. */
  readonly scale: number;
  /** Leg length before scaling. */
  readonly legLength: number;
  readonly width: number;
}

/** A four-legged voxel beast, facing +z, with a saddle. `extras` adds horns, tails and manes. */
function quadruped(look: Beast, extras: (body: THREE.Group, top: number) => void): MountRig {
  const root = new THREE.Group();
  const body = joint(root, 0, 0, 0);
  const hip = look.legLength;
  const top = hip + 0.52;
  part(body, look.width, 0.52, 1.5, look.body, 0, hip + 0.26, 0);
  part(body, look.width * 0.8, 0.12, 1.2, look.belly, 0, hip + 0.02, 0);
  part(body, 0.3, 0.5, 0.32, look.body, 0, top + 0.05, 0.72);
  part(body, 0.36, 0.34, 0.56, look.head, 0, top + 0.32, 0.98);
  for (const s of [-1, 1]) part(body, 0.06, 0.08, 0.02, look.eye, s * 0.14, top + 0.38, 1.265, look.glowEyes);
  part(body, look.width * 0.7, 0.08, 0.5, 0x8c2f2a, 0, top + 0.04, -0.05);
  part(body, look.width * 0.74, 0.22, 0.06, 0x6b231f, 0, top - 0.07, 0.2);
  const legs = ([[-1, 0.52], [1, 0.52], [-1, -0.52], [1, -0.52]] as const).map(([s, z]) => {
    const leg = joint(body, s * (look.width / 2 - 0.1), hip, z);
    part(leg, 0.16, hip, 0.16, look.legs, 0, -hip / 2, 0);
    return leg;
  });
  extras(body, top);
  root.scale.setScalar(look.scale);
  return {
    root, body, legs, arms: [], armR: null, armL: null, lamp: null, hop: false, splay: false,
    height: (top + 0.5) * look.scale, saddle: (top + 0.02) * look.scale - 0.45,
  };
}

const MOUNT_BUILDERS: Readonly<Record<MountId, () => MountRig>> = {
  strider: () =>
    quadruped({ body: 0xc8925a, belly: 0xf1e3c8, legs: 0x8f6338, head: 0xc8925a, eye: 0x1d1a22, scale: 1, legLength: 0.8, width: 0.6 }, (b, top) => {
      for (const s of [-1, 1]) {
        part(b, 0.05, 0.3, 0.05, 0x8a6a3c, s * 0.12, top + 0.62, 0.9);
        part(b, 0.16, 0.05, 0.05, 0x8a6a3c, s * 0.18, top + 0.72, 0.9);
      }
      part(b, 0.16, 0.16, 0.12, 0xf6efe4, 0, top - 0.1, -0.8);
    }),
  hog: () =>
    quadruped({ body: 0x6b4a33, belly: 0x8a6448, legs: 0x4a3324, head: 0x5b3e2b, eye: 0x1d1a22, scale: 1.05, legLength: 0.55, width: 0.82 }, (b, top) => {
      part(b, 0.22, 0.18, 1.1, 0x3c2a1e, 0, top + 0.08, -0.05);
      for (const s of [-1, 1]) part(b, 0.07, 0.22, 0.07, 0xf1ead8, s * 0.2, top + 0.22, 1.24);
      part(b, 0.32, 0.22, 0.12, 0xc9967a, 0, top + 0.24, 1.3);
    }),
  runner: () =>
    quadruped({ body: 0xd99a4a, belly: 0xf0d090, legs: 0xb07a38, head: 0xd99a4a, eye: 0x1d1a22, scale: 1, legLength: 0.5, width: 0.7 }, (b, top) => {
      part(b, 0.3, 0.24, 0.6, 0xc4863c, 0, top - 0.2, -1.0);
      part(b, 0.2, 0.16, 0.6, 0xb07a38, 0, top - 0.3, -1.55);
      for (let i = 0; i < 4; i++) part(b, 0.08, 0.12, 0.12, 0x8c3b2a, 0, top + 0.06, 0.4 - i * 0.3);
    }),
  elk: () =>
    quadruped({ body: 0xb8c4cc, belly: 0xe8eef2, legs: 0x5a6470, head: 0xc8d2da, eye: 0x1d1a22, scale: 1.12, legLength: 0.85, width: 0.66 }, (b, top) => {
      for (const s of [-1, 1]) {
        part(b, 0.06, 0.42, 0.06, 0xe8e0d0, s * 0.14, top + 0.7, 0.9);
        part(b, 0.3, 0.06, 0.06, 0xe8e0d0, s * 0.3, top + 0.88, 0.9);
        part(b, 0.06, 0.24, 0.06, 0xe8e0d0, s * 0.44, top + 1.0, 0.9);
        part(b, 0.06, 0.2, 0.06, 0xe8e0d0, s * 0.26, top + 1.0, 0.9);
      }
      part(b, 0.3, 0.2, 0.14, 0xe8eef2, 0, top + 0.1, 0.62);
    }),
  steed: () =>
    quadruped({ body: 0x2b2238, belly: 0x3b2f4c, legs: 0x1e1828, head: 0x2b2238, eye: 0xc9a3ff, glowEyes: true, scale: 1.1, legLength: 0.85, width: 0.62 }, (b, top) => {
      for (let i = 0; i < 5; i++) part(b, 0.1, 0.16, 0.12, 0x9a6cff, 0, top + 0.28 - i * 0.04, 0.82 - i * 0.14, true);
      part(b, 0.12, 0.5, 0.12, 0x9a6cff, 0, top - 0.2, -0.82, true);
    }),
};

export const buildMount = (id: MountId): MountRig => MOUNT_BUILDERS[id]();

/** A pet rig. Floating pets bob in the air instead of walking. */
export interface PetRig extends ModelRig {
  readonly float: boolean;
}

function critter(build: (body: THREE.Group) => THREE.Group[], flags: { hop?: boolean; splay?: boolean; float?: boolean }, height: number): PetRig {
  const root = new THREE.Group();
  const body = joint(root, 0, 0, 0);
  const legs = build(body);
  return {
    root, body, legs, arms: [], armR: null, armL: null, lamp: null,
    hop: flags.hop ?? false, splay: flags.splay ?? false, float: flags.float ?? false, height,
  };
}

const smallLegs = (body: THREE.Group, color: number, w: number, z: number, h: number): THREE.Group[] =>
  ([[-1, 1], [1, 1], [-1, -1], [1, -1]] as const).map(([sx, sz]) => {
    const leg = joint(body, sx * w, h, sz * z);
    part(leg, 0.08, h, 0.08, color, 0, -h / 2, 0);
    return leg;
  });

const PET_BUILDERS: Readonly<Record<PetId, () => PetRig>> = {
  fox: () =>
    critter((b) => {
      part(b, 0.26, 0.22, 0.5, 0xe0742e, 0, 0.3, 0);
      part(b, 0.26, 0.22, 0.24, 0xe0742e, 0, 0.44, 0.3);
      part(b, 0.12, 0.1, 0.1, 0xf6efe4, 0, 0.4, 0.45);
      for (const s of [-1, 1]) {
        part(b, 0.07, 0.12, 0.05, 0xe0742e, s * 0.08, 0.6, 0.28);
        part(b, 0.04, 0.05, 0.02, 0x1d1a22, s * 0.07, 0.48, 0.42);
      }
      part(b, 0.14, 0.14, 0.36, 0xe0742e, 0, 0.36, -0.38);
      part(b, 0.14, 0.14, 0.12, 0xf6efe4, 0, 0.38, -0.6);
      return smallLegs(b, 0x5a3220, 0.08, 0.16, 0.2);
    }, {}, 0.7),
  frog: () =>
    critter((b) => {
      part(b, 0.36, 0.2, 0.34, 0x5fa04a, 0, 0.12, 0);
      for (const s of [-1, 1]) {
        part(b, 0.1, 0.1, 0.1, 0xe8d26a, s * 0.1, 0.26, 0.1);
        part(b, 0.04, 0.05, 0.02, 0x1d1a22, s * 0.1, 0.26, 0.155);
      }
      return [];
    }, { hop: true }, 0.4),
  boarlet: () =>
    critter((b) => {
      part(b, 0.3, 0.24, 0.44, 0x8a6448, 0, 0.28, 0);
      part(b, 0.05, 0.25, 0.42, 0xc9a07a, 0, 0.3, 0);
      part(b, 0.24, 0.2, 0.18, 0x7a5638, 0, 0.3, 0.28);
      part(b, 0.12, 0.08, 0.04, 0xc9967a, 0, 0.27, 0.38);
      return smallLegs(b, 0x5a3e2a, 0.1, 0.14, 0.17);
    }, {}, 0.55),
  scuttle: () =>
    critter((b) => {
      part(b, 0.36, 0.14, 0.3, 0xd2a060, 0, 0.16, 0);
      for (const s of [-1, 1]) part(b, 0.1, 0.08, 0.14, 0xb07f45, s * 0.2, 0.16, 0.2);
      const legs: THREE.Group[] = [];
      for (const s of [-1, 1]) {
        for (const z of [-0.08, 0.08]) {
          const leg = joint(b, s * 0.18, 0.12, z);
          part(leg, 0.14, 0.04, 0.04, 0x9a6a38, s * 0.06, -0.03, 0);
          legs.push(leg);
        }
      }
      return legs;
    }, { splay: true }, 0.4),
  sprite: () =>
    critter((b) => {
      part(b, 0.26, 0.26, 0.26, 0x9ff7ff, 0, 0.9, 0, true);
      for (const s of [-1, 1]) part(b, 0.24, 0.16, 0.03, 0xe8fbff, s * 0.24, 0.96, -0.02);
      return [];
    }, { float: true }, 1.2),
  moth: () =>
    critter((b) => {
      part(b, 0.14, 0.14, 0.3, 0x3b2f4c, 0, 0.95, 0);
      for (const s of [-1, 1]) part(b, 0.3, 0.03, 0.26, 0xd8cfe8, s * 0.2, 0.98, 0);
      for (const s of [-1, 1]) part(b, 0.03, 0.03, 0.03, 0xffd27a, s * 0.04, 0.98, 0.16, true);
      return [];
    }, { float: true }, 1.2),
  mote: () =>
    critter((b) => {
      part(b, 0.22, 0.22, 0.22, 0xb28be0, 0, 1.0, 0, true);
      part(b, 0.12, 0.12, 0.12, 0xf0e4ff, 0, 1.0, 0, true);
      return [];
    }, { float: true }, 1.2),
};

export const buildPet = (id: PetId): PetRig => PET_BUILDERS[id]();
