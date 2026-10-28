import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { MAX_CLIENT_MESSAGE_BYTES } from '@lanternwood/shared';
import type { GameWorld } from './application/game-world';
import type { Logger, SystemTime } from './application/ports';
import type { SessionService } from './application/session-service';
import type { ServerConfig } from './config';
import type { PlayerRepository } from './domain/ports';
import { createHttpServer } from './infrastructure/http/http-server';
import { WebSocketGateway } from './infrastructure/network/websocket-gateway';
import { createTokenHasher } from './infrastructure/security/token-hasher';
import { createSimulation } from './simulation';

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
 * Composition root for the online server: the shared simulation plus HTTP, the WebSocket
 * gateway and autosave. Kept separate from main.ts so integration tests can boot a real
 * server in-process.
 */
export function createGameServer({ config, logger, time, repository }: GameServerDependencies): GameServer {
  const { world, sessions, loop } = createSimulation({
    config,
    repository,
    logger,
    time,
    hashToken: createTokenHasher(config.tokenSalt),
  });
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
