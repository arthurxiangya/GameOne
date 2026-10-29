import type { ModeState, MonsterType, PetId, RandomSource, SkillId, Vec3 } from '@lanternwood/shared';
import type { AchievementSink } from '../../domain/achievements';
import type { Monster, MonsterOptions } from '../../domain/entities/monster';
import type { Player } from '../../domain/entities/player';
import type { EventSink } from '../../domain/events';
import type { Calendar } from '../../domain/ports';
import type { ProgressionService } from '../../domain/services/progression-service';
import type { LeaderboardSink } from '../leaderboards';

/**
 * A game mode plugged into the world: Ember Run, Lantern Night, Rift Trials, duels. Modes
 * act on the world only through ModeHost, and shape the rules (who may hit whom, who monsters
 * ignore, when a hero may ride) through the optional hooks, so the simulation core never
 * grows a branch per mode.
 */
export interface GameMode {
  /** Runs every tick, after heroes move and monsters act. */
  step(dt: number): void;
  /** The hero's state in this mode for their HUD, or null if they are not in it. */
  status(player: Player): ModeState | null;
  /** Gives up whatever the hero is doing in this mode. Returns false if they were not in it. */
  quit?(player: Player): boolean;
  onPlayerRemoved?(player: Player): void;
  /** The hero fell off the world and is about to be rescued to town. */
  onPlayerFell?(player: Player): void;
  /** A reason the hero may not use this skill right now, or null. */
  skillBlocked?(player: Player, skill: SkillId): string | null;
  /** A reason the hero may not call a mount right now, or null. */
  mountBlocked?(player: Player): string | null;
  /** True if monsters should leave this hero alone. */
  ignoredByMonsters?(player: Player): boolean;
  /** True while the hero's movement input is ignored (a start countdown). */
  frozen?(player: Player): boolean;
  /** A hero hit a monster; `killed` if it died. */
  onMonsterHit?(monster: Monster, attacker: Player | null, amount: number, killed: boolean): void;
  /** A monster with a goal struck it. */
  onGoalStruck?(monster: Monster, amount: number): void;
}

/** What modes may do to the world. Implemented by GameWorld. */
export interface ModeHost {
  readonly events: EventSink;
  readonly achievements: AchievementSink;
  readonly progression: ProgressionService;
  readonly boards: LeaderboardSink;
  readonly calendar: Calendar;
  readonly rng: RandomSource;
  readonly dayLengthSeconds: number;
  /** Simulation time in seconds. */
  now(): number;
  /** Time of day in [0, 1). */
  timeOfDay(): number;
  players(): Iterable<Player>;
  teleport(player: Player, to: Readonly<Vec3>): void;
  /** The hero's mode state changed; their client is told after this tick. */
  modeChanged(player: Player): void;
  spawnMonster(type: MonsterType, level: number, x: number, z: number, options: MonsterOptions): Monster;
  removeMonster(monster: Monster): void;
  grantPet(player: Player, pet: PetId): void;
}
