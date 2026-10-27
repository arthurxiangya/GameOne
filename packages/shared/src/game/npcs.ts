export type NpcId = 'maren' | 'oda';
export type NpcAction = 'questAccept' | 'questTurnIn' | 'buyTonic' | 'sharpen';

export interface NpcDef {
  readonly id: NpcId;
  readonly name: string;
  readonly role: 'quests' | 'shop';
  readonly x: number;
  readonly z: number;
  /** Facing when no player is nearby. */
  readonly yaw: number;
  readonly actions: readonly NpcAction[];
}

/** Players must stand this close to an NPC for the server to accept an action. */
export const NPC_INTERACT_RANGE = 4.5;

export const NPCS: readonly NpcDef[] = [
  { id: 'maren', name: 'Elder Maren', role: 'quests', x: 0, z: -4.6, yaw: 0, actions: ['questAccept', 'questTurnIn'] },
  { id: 'oda', name: 'Smith Oda', role: 'shop', x: 4.4, z: -9.4, yaw: -Math.PI / 2, actions: ['buyTonic', 'sharpen'] },
];

export const npcById = (id: string): NpcDef | undefined => NPCS.find((n) => n.id === id);

export const isNpcAction = (v: unknown): v is NpcAction =>
  v === 'questAccept' || v === 'questTurnIn' || v === 'buyTonic' || v === 'sharpen';
