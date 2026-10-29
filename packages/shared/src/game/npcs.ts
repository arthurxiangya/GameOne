export type NpcId = 'maren' | 'oda' | 'rook' | 'ilka' | 'pip' | 'tamsin' | 'bryn' | 'sefa';

/** What a character offers besides story: Oda's forge and Mark trades, Rook's bounty board. */
export type NpcService = 'forge' | 'marks' | 'bounties' | 'race';

/**
 * Everything a hero can do with a character. `greet` opens a conversation (it counts for
 * bounties that ask you to visit people); the story actions name a chain, `buy` names an item.
 */
export type NpcAction = 'greet' | 'accept' | 'turnIn' | 'talk' | 'buyTonic' | 'sharpen' | 'buy' | 'race';

export const NPC_ACTIONS: readonly NpcAction[] = ['greet', 'accept', 'turnIn', 'talk', 'buyTonic', 'sharpen', 'buy', 'race'];

/** Actions that belong to a service only that service's characters provide. */
export const ACTION_SERVICE: Readonly<Partial<Record<NpcAction, NpcService>>> = {
  buyTonic: 'forge',
  sharpen: 'forge',
  buy: 'marks',
  race: 'race',
};

export interface NpcDef {
  readonly id: NpcId;
  readonly name: string;
  /** A few words under the name. */
  readonly role: string;
  readonly x: number;
  readonly z: number;
  /** Facing when no hero is nearby. */
  readonly yaw: number;
  readonly services: readonly NpcService[];
  /** What they say when there is nothing else to talk about. */
  readonly idle: string;
}

/**
 * Where each character stands. Town characters stand on the flat plaza; characters out in the
 * zones are moved by the world generator to the nearest solid, dry ground, so they never end up
 * in a lake or a tree whatever the seed.
 */
export interface NpcPlacement extends NpcDef {
  readonly snap: boolean;
}

export const NPC_PLACEMENTS: readonly NpcPlacement[] = [
  {
    id: 'maren', name: 'Elder Maren', role: 'Elder of Emberhold', x: 0, z: -4.6, yaw: 0, services: [], snap: false,
    idle: 'The lanterns burn a little brighter with you here.',
  },
  {
    id: 'oda', name: 'Smith Oda', role: 'Smith', x: 4.4, z: -9.4, yaw: -Math.PI / 2, services: ['forge', 'marks'], snap: false,
    idle: 'Steel, tonics, and fair trades for Ember Marks.',
  },
  {
    id: 'rook', name: 'Captain Rook', role: 'Captain of the Watch', x: -4.4, z: 9.4, yaw: Math.PI / 2, services: ['bounties'], snap: false,
    idle: 'Three bounties a day, posted at midnight. Keep the roads safe and the Watch pays.',
  },
  {
    id: 'ilka', name: 'Seer Ilka', role: 'Seer', x: -4.4, z: -9.4, yaw: Math.PI / 2, services: [], snap: false,
    idle: 'The sky is thin past the southern cliffs. I can feel it from here.',
  },
  {
    id: 'pip', name: 'Pip the Runner', role: 'Keeper of the Ember Run', x: 3.4, z: 13, yaw: -Math.PI / 2, services: ['race'], snap: false,
    idle: 'Round the whole island and back, as fast as your legs carry you. No mounts, no fighting, no excuses.',
  },
  {
    id: 'tamsin', name: 'Tamsin', role: 'Fisher of Reedmere', x: -34, z: 3, yaw: Math.PI / 2, services: [], snap: true,
    idle: 'Quiet water today. I like it quiet.',
  },
  {
    id: 'bryn', name: 'Ranger Bryn', role: 'Ranger of Lanternwood', x: 34, z: -3, yaw: -Math.PI / 2, services: [], snap: true,
    idle: 'Mind the boars, and keep to the paths after dark.',
  },
  {
    id: 'sefa', name: 'Sefa', role: 'Caravan master', x: -3, z: 34, yaw: Math.PI, services: [], snap: true,
    idle: 'The caravans roll at dawn. Sand in everything, as usual.',
  },
];

export const NPC_IDS: readonly NpcId[] = NPC_PLACEMENTS.map((n) => n.id);

export const isNpcId = (v: unknown): v is NpcId => typeof v === 'string' && NPC_IDS.includes(v as NpcId);

export const isNpcAction = (v: unknown): v is NpcAction => typeof v === 'string' && NPC_ACTIONS.includes(v as NpcAction);

/** Players must stand this close to a character for the server to accept an action. */
export const NPC_INTERACT_RANGE = 4.5;

/** Looks a character up in a placed list (see `GeneratedWorld.npcs`). */
export const findNpc = (npcs: readonly NpcDef[], id: NpcId): NpcDef | undefined => npcs.find((n) => n.id === id);

/** Display name of a character, for text that mentions them. */
export const npcName = (id: NpcId): string => NPC_PLACEMENTS.find((n) => n.id === id)?.name ?? id;
