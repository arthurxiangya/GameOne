import { Mulberry32, generateWorld, type GeneratedWorld } from '@lanternwood/shared';
import { GameWorld } from './application/game-world';
import type { Logger, SystemTime, TokenHasher } from './application/ports';
import { SessionService } from './application/session-service';
import type { PlayerRepository } from './domain/ports';
import { FixedStepLoop } from './infrastructure/scheduling/fixed-step-loop';

export interface SimulationConfig {
  readonly worldSeed: number;
  readonly tickRate: number;
  readonly snapshotEveryTicks: number;
  readonly maxPlayers: number;
  readonly interestRadius: number;
  readonly dayLengthSeconds: number;
}

export interface SimulationDependencies {
  readonly config: SimulationConfig;
  readonly repository: PlayerRepository;
  readonly logger: Logger;
  readonly time: SystemTime;
  readonly hashToken: TokenHasher;
  /** Reuse an already generated realm instead of generating it from the seed again. */
  readonly generated?: GeneratedWorld;
}

export interface Simulation {
  readonly world: GameWorld;
  readonly sessions: SessionService;
  readonly loop: FixedStepLoop;
}

/**
 * The transport-independent core of a game server: the world, the session service and the
 * fixed-step loop that drives them. Contains no Node APIs, so the online server (app.ts) and
 * the in-browser single-player server (embedded.ts) are built from exactly the same parts.
 */
export function createSimulation({ config, repository, logger, time, hashToken, generated }: SimulationDependencies): Simulation {
  const realm = generated ?? generateWorld(config.worldSeed);
  const world = new GameWorld({
    generated: realm,
    rng: new Mulberry32((config.worldSeed ^ Date.now()) | 0),
    dayLengthSeconds: config.dayLengthSeconds,
  });
  const sessions = new SessionService({
    world,
    repository,
    logger: logger.child({ component: 'sessions' }),
    time,
    hashToken,
    options: {
      maxPlayers: config.maxPlayers,
      interestRadius: config.interestRadius,
      snapshotEveryTicks: config.snapshotEveryTicks,
      tickRate: config.tickRate,
      dayLengthSeconds: config.dayLengthSeconds,
    },
  });
  const loop = new FixedStepLoop(
    config.tickRate,
    (dt) => {
      world.step(dt);
      sessions.afterTick();
    },
    time,
    logger.child({ component: 'loop' }),
  );
  return { world, sessions, loop };
}
