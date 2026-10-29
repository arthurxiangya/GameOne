import * as THREE from 'three';
import { MONSTERS, type Look, type MonsterType, type NpcId } from '@lanternwood/shared';

/** A voxel character: the root to position, plus the joints the animator moves. */
export interface ModelRig {
  readonly root: THREE.Group;
  readonly body: THREE.Group;
  readonly legs: readonly THREE.Group[];
  readonly arms: readonly THREE.Group[];
  readonly armR: THREE.Group | null;
  readonly armL: THREE.Group | null;
  readonly lamp: THREE.Mesh | null;
  /** Hopping creatures bounce instead of walking. */
  readonly hop: boolean;
  /** Crab-like legs wiggle sideways. */
  readonly splay: boolean;
  /** Unscaled height, for nameplates. */
  readonly height: number;
}

const box = new THREE.BoxGeometry(1, 1, 1);
const lit = new Map<number, THREE.MeshLambertMaterial>();
const unlit = new Map<number, THREE.MeshBasicMaterial>();
const lambert = (hex: number): THREE.MeshLambertMaterial => {
  let m = lit.get(hex);
  if (!m) lit.set(hex, (m = new THREE.MeshLambertMaterial({ color: hex })));
  return m;
};
const basic = (hex: number): THREE.MeshBasicMaterial => {
  let m = unlit.get(hex);
  if (!m) unlit.set(hex, (m = new THREE.MeshBasicMaterial({ color: hex })));
  return m;
};

function part(parent: THREE.Object3D, w: number, h: number, d: number, hex: number, x: number, y: number, z: number, glow = false): THREE.Mesh {
  const mesh = new THREE.Mesh(box, glow ? basic(hex) : lambert(hex));
  mesh.scale.set(w, h, d);
  mesh.position.set(x, y, z);
  mesh.castShadow = !glow;
  parent.add(mesh);
  return mesh;
}

function joint(parent: THREE.Object3D, x: number, y: number, z: number): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}

interface HeroOptions {
  readonly lamp?: boolean;
  readonly blade?: boolean;
  readonly staff?: boolean;
  readonly hammer?: boolean;
  readonly robe?: boolean;
  readonly beard?: number;
  /** A long fishing rod over the shoulder. */
  readonly rod?: boolean;
  /** A wide-brimmed hat in this colour. */
  readonly hat?: number;
}

/** Hooded lantern-keeper figure used for players and townsfolk. */
export function buildHero(look: Look, options: HeroOptions = {}): ModelRig {
  const root = new THREE.Group();
  const legL = joint(root, -0.12, 0.45, 0);
  const legR = joint(root, 0.12, 0.45, 0);
  part(legL, 0.18, 0.45, 0.2, look.boots, 0, -0.225, 0);
  part(legR, 0.18, 0.45, 0.2, look.boots, 0, -0.225, 0);
  const body = joint(root, 0, 0, 0);
  part(body, 0.5, 0.6, 0.32, look.cloak, 0, 0.75, 0);
  if (options.robe) part(body, 0.56, 0.36, 0.38, look.cloak, 0, 0.36, 0);
  part(body, 0.42, 0.38, 0.38, look.skin, 0, 1.24, 0);
  part(body, 0.07, 0.07, 0.02, 0x1d1a22, -0.09, 1.27, 0.195);
  part(body, 0.07, 0.07, 0.02, 0x1d1a22, 0.09, 1.27, 0.195);
  if (options.beard !== undefined) part(body, 0.36, 0.18, 0.06, options.beard, 0, 1.1, 0.2);
  part(body, 0.48, 0.14, 0.44, look.hood, 0, 1.47, 0);
  part(body, 0.3, 0.22, 0.3, look.hood, 0, 1.62, -0.02);
  const armR = joint(body, 0.31, 1.02, 0.02);
  const armL = joint(body, -0.31, 1.02, 0.02);
  part(armR, 0.12, 0.42, 0.14, look.cloak, 0, -0.2, 0);
  part(armL, 0.12, 0.42, 0.14, look.cloak, 0, -0.2, 0);
  const lamp = options.lamp ? part(armL, 0.16, 0.2, 0.16, 0xffd27a, 0, -0.5, 0.06, true) : null;
  if (options.blade) {
    part(armR, 0.18, 0.06, 0.07, 0xd9a441, 0, -0.42, 0.06);
    part(armR, 0.06, 0.08, 0.74, 0xdfe4ec, 0, -0.42, 0.46);
  }
  if (options.staff) {
    part(armR, 0.08, 1.7, 0.08, 0x6f4b2d, 0, -0.2, 0.12);
    part(armR, 0.18, 0.18, 0.18, 0x9ff7ff, 0, 0.7, 0.12, true);
  }
  if (options.rod) {
    const rod = part(armR, 0.05, 2.1, 0.05, 0x8a6a3c, 0, 0.35, -0.1);
    rod.rotation.x = -0.5;
  }
  if (options.hat !== undefined) part(body, 0.74, 0.06, 0.74, options.hat, 0, 1.56, 0);
  if (options.hammer) {
    part(armR, 0.07, 0.6, 0.07, 0x6f4b2d, 0, -0.45, 0.12);
    part(armR, 0.32, 0.2, 0.2, 0x8f939c, 0, -0.75, 0.12);
  }
  return { root, body, legs: [legL, legR], arms: [], armR, armL, lamp, hop: false, splay: false, height: 1.8 };
}

const NPC_LOOKS: Readonly<Record<NpcId, { look: Look; options: HeroOptions }>> = {
  maren: { look: { cloak: 0x6a4c8c, hood: 0xe2cf8c, skin: 0xe9c9a6, boots: 0x3b2e2a }, options: { robe: true, staff: true, beard: 0xe8e2d6 } },
  oda: { look: { cloak: 0x8a4a2c, hood: 0x5b6270, skin: 0xd9a77f, boots: 0x2e2622 }, options: { hammer: true } },
  rook: { look: { cloak: 0x46546e, hood: 0x9aa3b2, skin: 0xc99a72, boots: 0x22262e }, options: { blade: true } },
  ilka: { look: { cloak: 0x4b2f6e, hood: 0xb28be0, skin: 0xf0d2b0, boots: 0x2a2236 }, options: { robe: true, staff: true } },
  tamsin: { look: { cloak: 0x2f6f7a, hood: 0xd9c38a, skin: 0xe6be98, boots: 0x3b2e2a }, options: { rod: true, hat: 0xd9c38a } },
  bryn: { look: { cloak: 0x3d5a2c, hood: 0x2b3f22, skin: 0xd9a77f, boots: 0x3b2e2a }, options: { blade: true, lamp: true } },
  sefa: { look: { cloak: 0xc98a3c, hood: 0xe8d2a0, skin: 0x9c6b4a, boots: 0x5a3a22 }, options: { robe: true, hat: 0xe8d2a0 } },
};

export const buildNpc = (id: NpcId): ModelRig => buildHero(NPC_LOOKS[id].look, NPC_LOOKS[id].options);

function golem(colors: { body: number; head: number; arm: number; leg: number; eye: number }, boss: boolean): ModelRig {
  const root = new THREE.Group();
  const body = joint(root, 0, 0, 0);
  const legL = joint(body, -0.32, 0.55, 0);
  const legR = joint(body, 0.32, 0.55, 0);
  part(legL, 0.46, 0.55, 0.5, colors.leg, 0, -0.27, 0);
  part(legR, 0.46, 0.55, 0.5, colors.leg, 0, -0.27, 0);
  part(body, 1.3, 1.1, 0.9, colors.body, 0, 1.1, 0);
  part(body, 0.7, 0.55, 0.6, colors.head, 0, 1.92, 0.05);
  part(body, 0.14, 0.08, 0.02, colors.eye, -0.16, 1.98, 0.36, true);
  part(body, 0.14, 0.08, 0.02, colors.eye, 0.16, 1.98, 0.36, true);
  const armL = joint(body, -0.86, 1.55, 0);
  const armR = joint(body, 0.86, 1.55, 0);
  part(armL, 0.42, 1.05, 0.46, colors.arm, 0, -0.5, 0);
  part(armR, 0.42, 1.05, 0.46, colors.arm, 0, -0.5, 0);
  part(body, 0.26, 0.42, 0.26, 0xd8f1ff, -0.55, 1.82, -0.12);
  part(body, 0.22, 0.34, 0.22, 0xd8f1ff, 0.58, 1.8, -0.1);
  if (boss) {
    part(body, 0.38, 0.38, 0.06, 0x9ff7ff, 0, 1.2, 0.46, true);
    part(body, 0.12, 0.3, 0.12, 0xd8f1ff, -0.22, 2.3, 0.05);
    part(body, 0.12, 0.4, 0.12, 0xd8f1ff, 0, 2.35, 0.05);
    part(body, 0.12, 0.3, 0.12, 0xd8f1ff, 0.22, 2.3, 0.05);
  }
  return { root, body, legs: [legL, legR], arms: [armL, armR], armR: null, armL: null, lamp: null, hop: false, splay: false, height: 2.4 };
}

const MONSTER_BUILDERS: Readonly<Record<MonsterType, () => ModelRig>> = {
  puffcap: () => {
    const root = new THREE.Group();
    const body = joint(root, 0, 0, 0);
    part(body, 0.46, 0.46, 0.46, 0xefe2c8, 0, 0.23, 0);
    part(body, 0.92, 0.34, 0.92, 0xd9573b, 0, 0.6, 0);
    part(body, 0.62, 0.12, 0.62, 0xd9573b, 0, 0.82, 0);
    part(body, 0.16, 0.06, 0.16, 0xf6efe4, 0.22, 0.79, 0.14);
    part(body, 0.14, 0.06, 0.14, 0xf6efe4, -0.2, 0.79, -0.18);
    part(body, 0.12, 0.05, 0.12, 0xf6efe4, -0.05, 0.89, 0.16);
    part(body, 0.07, 0.09, 0.02, 0x1d1a22, -0.1, 0.3, 0.235);
    part(body, 0.07, 0.09, 0.02, 0x1d1a22, 0.1, 0.3, 0.235);
    return { root, body, legs: [], arms: [], armR: null, armL: null, lamp: null, hop: true, splay: false, height: MONSTERS.puffcap.height };
  },
  toad: () => {
    const root = new THREE.Group();
    const body = joint(root, 0, 0, 0);
    part(body, 0.9, 0.42, 0.86, 0x5e8f4a, 0, 0.24, 0);
    part(body, 0.7, 0.08, 0.66, 0xd8c46a, 0, 0.04, 0.02);
    part(body, 0.74, 0.26, 0.4, 0x6a9c52, 0, 0.44, 0.24);
    for (const s of [-1, 1]) {
      part(body, 0.18, 0.18, 0.18, 0xe8d26a, s * 0.22, 0.62, 0.24);
      part(body, 0.07, 0.1, 0.02, 0x1d1a22, s * 0.22, 0.62, 0.335);
      part(body, 0.22, 0.2, 0.42, 0x557f42, s * 0.47, 0.12, -0.18);
    }
    return { root, body, legs: [], arms: [], armR: null, armL: null, lamp: null, hop: true, splay: false, height: MONSTERS.toad.height };
  },
  boar: () => {
    const root = new THREE.Group();
    const body = joint(root, 0, 0, 0);
    part(body, 0.8, 0.6, 1.3, 0x6b4a33, 0, 0.66, 0);
    part(body, 0.22, 0.16, 1.0, 0x3c2a1e, 0, 1.02, -0.05);
    part(body, 0.6, 0.5, 0.5, 0x5b3e2b, 0, 0.7, 0.86);
    part(body, 0.32, 0.24, 0.16, 0xc9967a, 0, 0.6, 1.16);
    for (const s of [-1, 1]) {
      part(body, 0.07, 0.22, 0.07, 0xf1ead8, s * 0.2, 0.66, 1.12);
      part(body, 0.06, 0.07, 0.02, 0x1d1a22, s * 0.17, 0.82, 1.115);
    }
    const legs = ([[-0.26, 0.42], [0.26, 0.42], [-0.26, -0.42], [0.26, -0.42]] as const).map(([x, z]) => {
      const leg = joint(body, x, 0.38, z);
      part(leg, 0.18, 0.38, 0.18, 0x4a3324, 0, -0.19, 0);
      return leg;
    });
    return { root, body, legs, arms: [], armR: null, armL: null, lamp: null, hop: false, splay: false, height: MONSTERS.boar.height };
  },
  scuttler: () => {
    const root = new THREE.Group();
    const body = joint(root, 0, 0, 0);
    part(body, 1.0, 0.36, 0.8, 0xc79a5a, 0, 0.4, 0);
    part(body, 0.5, 0.26, 0.3, 0xb88a4e, 0, 0.44, 0.5);
    for (const s of [-1, 1]) {
      part(body, 0.2, 0.16, 0.46, 0xb07f45, s * 0.46, 0.4, 0.5);
      part(body, 0.3, 0.22, 0.26, 0xa8743c, s * 0.5, 0.42, 0.84);
      part(body, 0.06, 0.12, 0.06, 0x1d1a22, s * 0.14, 0.64, 0.56);
    }
    part(body, 0.24, 0.22, 0.3, 0xb88a4e, 0, 0.54, -0.52);
    part(body, 0.22, 0.22, 0.24, 0xb07f45, 0, 0.82, -0.68);
    part(body, 0.2, 0.22, 0.22, 0xa8743c, 0, 1.08, -0.58);
    part(body, 0.12, 0.24, 0.12, 0x5a3a20, 0, 1.14, -0.38);
    const legs: THREE.Group[] = [];
    for (const s of [-1, 1]) {
      for (const z of [-0.25, 0, 0.25]) {
        const leg = joint(body, s * 0.5, 0.32, z);
        part(leg, 0.34, 0.07, 0.07, 0x9a6a38, s * 0.15, -0.06, 0);
        legs.push(leg);
      }
    }
    return { root, body, legs, arms: [], armR: null, armL: null, lamp: null, hop: false, splay: true, height: MONSTERS.scuttler.height };
  },
  golem: () => golem({ body: 0x8fb4c6, head: 0x9cc2d4, arm: 0x7fa2b4, leg: 0x6f8fa0, eye: 0x7ff5ff }, false),
  warden: () => golem({ body: 0x6a72b8, head: 0x7d86c8, arm: 0x5b62a0, leg: 0x4c528a, eye: 0xffb86b }, true),
};

export const buildMonster = (type: MonsterType): ModelRig => MONSTER_BUILDERS[type]();
