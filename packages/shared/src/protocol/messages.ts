import type { Board } from '../game/leaderboards';
import type { MonsterType } from '../game/monsters';
import type { MountId } from '../game/mounts';
import type { PetId } from '../game/pets';
import type { SiegeState } from '../game/siege';
import type { NpcAction, NpcId } from '../game/npcs';
import type { PlayerProgress } from '../game/progress';
import type { SkillId } from '../game/skills';
import type { ClassId, SpecId } from '../game/classes';
import type { TitleId } from '../game/titles';

/**
 * Wire protocol v3. Messages are JSON objects discriminated by `t`.
 * Field names are short because snapshots are sent twenty times a second.
 */

// ---------------------------------------------------------------- client -> server

/** One fixed-step (SIM_DT) frame of movement intent, numbered for reconciliation. */
export interface InputFrame {
  readonly seq: number;
  readonly fwd: number;
  readonly strafe: number;
  readonly yaw: number;
  readonly jump: boolean;
  readonly swim: boolean;
}

export type ClientMessage =
  /** `cls` is the class chosen on the title screen; heroes always enter in town, where class changes are allowed. */
  | { readonly t: 'hello'; readonly v: number; readonly token: string; readonly name: string; readonly cls: ClassId }
  | { readonly t: 'input'; readonly frames: readonly InputFrame[] }
  | { readonly t: 'skill'; readonly skill: SkillId; readonly target: number | null }
  /** `arg` names the story chain for story actions and the item for `buy`; null otherwise. */
  | { readonly t: 'npc'; readonly npc: NpcId; readonly action: NpcAction; readonly arg: string | null }
  /** Choose which earned title shows under your name (null for none). */
  | { readonly t: 'title'; readonly title: TitleId | null }
  /** Change class (in Emberhold, out of combat) and/or specialization (level 10+, out of combat). */
  | { readonly t: 'class'; readonly cls: ClassId; readonly spec: SpecId | null }
  /** Pick a talent for your current class: `pick` 0–2 in `row` 0–3, or null to clear (out of combat). */
  | { readonly t: 'talent'; readonly row: number; readonly pick: number | null }
  /** Call your mount (`on`), or get off it. */
  | { readonly t: 'mount'; readonly on: boolean }
  /** Choose which owned mount R calls, or which pet follows you (null for none). */
  | { readonly t: 'choose'; readonly kind: 'mount'; readonly id: MountId | null }
  | { readonly t: 'choose'; readonly kind: 'pet'; readonly id: PetId | null }
  | { readonly t: 'petName'; readonly pet: PetId; readonly name: string }
  /** Give up the current run (and, later, other mode activities). */
  | { readonly t: 'quit' }
  /** Ask for the leaderboards. */
  | { readonly t: 'boards' }
  /** Challenge another hero (by entity id) to a duel, or answer a challenge. */
  | { readonly t: 'duel'; readonly action: 'challenge'; readonly target: number }
  | { readonly t: 'duel'; readonly action: 'accept' | 'decline' }
  | { readonly t: 'chat'; readonly text: string }
  | { readonly t: 'respawn' }
  | { readonly t: 'ping'; readonly at: number };

// ---------------------------------------------------------------- server -> client

export type MonsterAnim = 'idle' | 'move' | 'attack' | 'dead';

export interface PlayerEntityState {
  readonly k: 'p';
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
  readonly hp: number;
  readonly mhp: number;
  readonly lv: number;
  readonly nm: string;
  readonly look: number;
  readonly dead: boolean;
  /** Title shown under the name. */
  readonly ti: TitleId | null;
  /** The mount being ridden. */
  readonly mt: MountId | null;
  /** The pet following this hero. */
  readonly pet: PetId | null;
  /** The hero's class. */
  readonly cl: ClassId;
}

export interface MonsterEntityState {
  readonly k: 'm';
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
  readonly hp: number;
  readonly mhp: number;
  readonly lv: number;
  readonly ty: MonsterType;
  /** Model scale. */
  readonly sc: number;
  readonly st: MonsterAnim;
}

export type EntityState = PlayerEntityState | MonsterEntityState;

/** Player fields that can change after the player first appears. */
export type PlayerEntityPatch = { readonly id: number } & Partial<Omit<PlayerEntityState, 'k' | 'id'>>;
/** Monster fields that can change after the monster first appears. */
export type MonsterEntityPatch = { readonly id: number } & Partial<Omit<MonsterEntityState, 'k' | 'id'>>;

/**
 * Delta encoding: the first time an entity is sent to a player it arrives in full (with `k`);
 * after that only the fields that changed since the previous snapshot are sent, and an entity
 * that changed nothing is left out. The stream is reliable and ordered, so patches always
 * apply on top of the previous snapshot.
 */
export type EntityUpdate = EntityState | PlayerEntityPatch | MonsterEntityPatch;

export const isFullEntity = (u: EntityUpdate): u is EntityState => 'k' in u;

/** The receiving player's own authoritative state. */
export interface SelfState {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly vx: number;
  readonly vy: number;
  readonly vz: number;
  readonly g: boolean;
  readonly hp: number;
  readonly mhp: number;
  readonly mp: number;
  readonly mmp: number;
  readonly dead: boolean;
  /** Remaining cooldown per skill of the current kit, in seconds. */
  readonly cd: Readonly<Partial<Record<SkillId, number>>>;
  /** Your active statuses: id, name, seconds left, and whether it helps you. */
  readonly st: readonly SelfStatus[];
  /** Damage your shield still absorbs. */
  readonly sh: number;
  /** The mount being ridden; movement prediction uses its speed. */
  readonly mt: MountId | null;
  /** Seconds left calling a mount, or 0. */
  readonly call: number;
}

export interface SelfStatus {
  readonly id: string;
  readonly name: string;
  readonly left: number;
  readonly good: boolean;
}

export type LogClass = 'sys' | 'foe' | 'loot' | 'good';

/** What a hero is doing in a game mode, for their HUD. Times are server simulation time. */
export type ModeState =
  | {
      readonly kind: 'race';
      readonly phase: 'countdown' | 'running';
      /** When the clock starts (or started). */
      readonly startsAt: number;
      /** Index into the course points of the next point to reach (1 = first checkpoint). */
      readonly next: number;
      /** Number of checkpoints, not counting the finish. */
      readonly total: number;
    }
  | {
      readonly kind: 'rift';
      readonly phase: RiftPhase;
      /** 1-based wave (0 before the first). */
      readonly wave: number;
      readonly waves: number;
      /** When the current phase ends (gathering, starting, break, done), or 0. */
      readonly endsAt: number;
      /** When the run runs out of time, or 0 while gathering. */
      readonly deadline: number;
      readonly remaining: number;
      readonly party: readonly string[];
      /** Final score once the run is over. */
      readonly score: number;
    }
  | DuelState;

export type RiftPhase = 'gathering' | 'starting' | 'wave' | 'break' | 'done' | 'failed';

/** A duel as one of its heroes sees it. */
export interface DuelState {
  readonly kind: 'duel';
  /** `invited`: someone challenged you. `challenging`: waiting for their answer. */
  readonly phase: 'invited' | 'challenging' | 'countdown' | 'fight';
  readonly opponent: string;
  readonly opponentId: number;
  /** When the current phase ends (server time). */
  readonly endsAt: number;
  readonly x: number;
  readonly z: number;
  readonly radius: number;
}

export type GameEvent =
  | { readonly e: 'dmg'; readonly id: number; readonly amt: number; readonly crit: boolean }
  | { readonly e: 'heal'; readonly id: number; readonly amt: number }
  | { readonly e: 'die'; readonly id: number }
  | { readonly e: 'lvl'; readonly id: number; readonly lv: number }
  | { readonly e: 'swing'; readonly id: number }
  | { readonly e: 'cast'; readonly id: number }
  | { readonly e: 'bolt'; readonly from: number; readonly to: number; readonly flight: number; readonly c: number }
  | { readonly e: 'ring'; readonly id: number; readonly r: number; readonly c: number }
  /** A status landed on someone, or a shield went up: a floating label. */
  | { readonly e: 'fx'; readonly id: number; readonly text: string; readonly good: boolean }
  | { readonly e: 'slamWarn'; readonly x: number; readonly y: number; readonly z: number; readonly r: number; readonly delay: number }
  | { readonly e: 'slam'; readonly x: number; readonly y: number; readonly z: number; readonly r: number }
  | { readonly e: 'xp'; readonly amt: number }
  | { readonly e: 'target'; readonly id: number | null }
  | { readonly e: 'log'; readonly text: string; readonly c: LogClass }
  | { readonly e: 'toast'; readonly text: string }
  | { readonly e: 'respawned'; readonly fell: boolean }
  /** A story step was completed; `text` is what the character says. */
  | { readonly e: 'story'; readonly title: string; readonly text: string }
  /** Something worth a big banner: a new mount, a hatched pet. */
  | { readonly e: 'banner'; readonly title: string; readonly text: string };

export type ServerMessage =
  | {
      readonly t: 'welcome';
      readonly v: number;
      readonly you: number;
      readonly seed: number;
      readonly tickRate: number;
      readonly look: number;
      readonly progress: PlayerProgress;
      /** Time of day in [0, 1). */
      readonly day: number;
      readonly dayLength: number;
    }
  | { readonly t: 'reject'; readonly reason: string }
  | {
      readonly t: 'snapshot';
      readonly tick: number;
      /** Server simulation time in seconds, for interpolation. */
      readonly st: number;
      readonly day: number;
      /** Highest input sequence number the server has applied for this player. */
      readonly ack: number;
      readonly you: SelfState;
      /** New entities in full, changed ones as patches (see EntityUpdate). */
      readonly ents: readonly EntityUpdate[];
      /** Entities that left this player's area of interest (or despawned). */
      readonly gone: readonly number[];
      readonly ev: readonly GameEvent[];
    }
  | { readonly t: 'progress'; readonly p: PlayerProgress }
  /** Your mode state changed (null: not in a mode). */
  | { readonly t: 'mode'; readonly m: ModeState | null }
  | { readonly t: 'boards'; readonly boards: readonly Board[] }
  /** Lantern Night, to everyone: the current siege, or null when there is none. */
  | { readonly t: 'siege'; readonly s: SiegeState | null }
  | { readonly t: 'chat'; readonly from: string; readonly text: string }
  | { readonly t: 'system'; readonly text: string }
  | { readonly t: 'error'; readonly reason: string }
  | { readonly t: 'pong'; readonly at: number; readonly server: number };

export type ServerMessageType = ServerMessage['t'];
export type SnapshotMessage = Extract<ServerMessage, { t: 'snapshot' }>;
export type WelcomeMessage = Extract<ServerMessage, { t: 'welcome' }>;
