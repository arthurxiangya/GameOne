import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { MAX_CLIENT_MESSAGE_BYTES, Mulberry32, generateWorld } from '@lanternwood/shared';
import { GameWorld } from './application/game-world';
import type { Logger, SystemTime } from './application/ports';
import { SessionService } from './application/session-service';
import type { ServerConfig } from './config';
import type { PlayerRepository } from './domain/ports';
import { createHttpServer } from './infrastructure/http/http-server';
import { WebSocketGateway } from './infrastructure/network/websocket-gateway';
import { FixedStepLoop } from './infrastructure/scheduling/fixed-step-loop';
import { createTokenHasher } from './infrastructure/security/token-hasher';

export interface GameServer {
  readonly world: GameWorld;
  readonly sessions: SessionService;
  /** Resolves with the bound port once listening. */
  listen(): Promise<number>;
  /** Saves every hero, disconnects clients and stops the loop. */
  stop(): Promise<void>;
}

export interface GameServerDependencies {
  readonly config: ServerConfig;
  readonly logger: Logger;
  readonly time: SystemTime;
  readonly repository: PlayerRepository;
}

/**
 * Composition root: wires the simulation, sessions, transport and HTTP together.
 * Kept separate from main.ts so integration tests can boot a real server in-process.
 */
export function createGameServer({ config, logger, time, repository }: GameServerDependencies): GameServer {
  const generated = generateWorld(config.worldSeed);
  const world = new GameWorld({
    generated,
    rng: new Mulberry32((config.worldSeed ^ Date.now()) | 0),
    dayLengthSeconds: config.dayLengthSeconds,
  });
  const sessions = new SessionService({
    world,
    repository,
    logger: logger.child({ component: 'sessions' }),
    time,
    hashToken: createTokenHasher(config.tokenSalt),
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
  const http: Server = createHttpServer({
    clientDist: config.clientDist,
    logger: logger.child({ component: 'http' }),
    health: () => ({
      status: 'ok',
      players: sessions.playerCount,
      connections: sessions.connectionCount,
      tick: world.tick,
      loop: loop.stats(),
    }),
  });
  const gateway = new WebSocketGateway(
    http,
    { path: '/ws', maxPayloadBytes: MAX_CLIENT_MESSAGE_BYTES, heartbeatSeconds: 15, allowedOrigins: config.allowedOrigins },
    {
      onConnect: (link) => sessions.connect(link),
      onMessage: (link, text) => void sessions.receive(link, text),
      onDisconnect: (link) => void sessions.disconnect(link),
    },
    logger.child({ component: 'gateway' }),
  );

  let autosave: NodeJS.Timeout | null = null;

  return {
    world,
    sessions,
    listen: () =>
      new Promise<number>((resolvePort, reject) => {
        http.once('error', reject);
        http.listen(config.port, config.host, () => {
          http.off('error', reject);
          loop.start();
          gateway.start();
          autosave = setInterval(() => void sessions.saveAll(), config.autosaveSeconds * 1000);
          autosave.unref();
          resolvePort((http.address() as AddressInfo).port);
        });
      }),
    stop: async () => {
      if (autosave) clearInterval(autosave);
      loop.stop();
      await sessions.shutdown();
      await gateway.close();
      await new Promise<void>((resolveClose) => http.close(() => resolveClose()));
    },
  };
}
