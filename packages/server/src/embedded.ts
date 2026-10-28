import { nullLogger, type ClientLink, type SystemTime } from './application/ports';
import type { PlayerRepository } from './domain/ports';
import { createSimulation } from './simulation';

export type { ClientLink, SystemTime } from './application/ports';
export type { PlayerRecord, PlayerRepository } from './domain/ports';
export { parsePlayerRecord } from './domain/player-record';
export { InMemoryPlayerRepository } from './infrastructure/persistence/in-memory-player-repository';

export interface EmbeddedServerOptions {
  readonly repository: PlayerRepository;
  readonly time: SystemTime;
  readonly worldSeed?: number;
  readonly dayLengthSeconds?: number;
  readonly autosaveSeconds?: number;
}

/** One client's end of an in-process connection. */
export interface EmbeddedConnection {
  /** Hands the server one JSON message from the client. */
  receive(text: string): void;
  /** Ends the session and saves the hero. */
  disconnect(): Promise<void>;
}

export interface EmbeddedServer {
  connect(link: ClientLink): EmbeddedConnection;
  saveAll(): Promise<void>;
  stop(): Promise<void>;
}

const SINGLE_PLAYER = {
  tickRate: 20,
  snapshotEveryTicks: 1,
  maxPlayers: 1,
  interestRadius: 80,
} as const;

/**
 * Account ids for single-player saves. Offline tokens never leave the device, so this does not
 * need to be a cryptographic hash, only stable and the same shape as an online account id.
 */
export function localTokenHasher(token: string): string {
  let out = '';
  for (const seed of [0x811c9dc5, 0x01000193, 0x9e3779b9, 0x85ebca6b]) {
    let h = seed >>> 0;
    for (let i = 0; i < token.length; i++) {
      h ^= token.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    out += h.toString(16).padStart(8, '0');
  }
  return out;
}

/**
 * The authoritative game server, running in the same process as the client. It is the same
 * simulation, rules, validation and session handling as the online server; only the transport
 * (a loopback link instead of a WebSocket) and the storage adapter differ. Contains no Node
 * APIs, so it runs in a browser tab. The simulation starts on the first connection.
 */
export function createEmbeddedServer(options: EmbeddedServerOptions): EmbeddedServer {
  const { sessions, loop } = createSimulation({
    config: {
      ...SINGLE_PLAYER,
      worldSeed: options.worldSeed ?? 2026,
      dayLengthSeconds: options.dayLengthSeconds ?? 480,
    },
    repository: options.repository,
    logger: nullLogger,
    time: options.time,
    hashToken: localTokenHasher,
  });
  let autosave: ReturnType<typeof setInterval> | null = null;
  let running = false;

  const start = (): void => {
    if (running) return;
    running = true;
    loop.start();
    autosave = setInterval(() => void sessions.saveAll(), (options.autosaveSeconds ?? 15) * 1000);
  };

  return {
    connect(link) {
      start();
      sessions.connect(link);
      return {
        receive: (text) => void sessions.receive(link, text),
        disconnect: () => sessions.disconnect(link),
      };
    },
    saveAll: () => sessions.saveAll(),
    async stop() {
      if (autosave) clearInterval(autosave);
      autosave = null;
      loop.stop();
      running = false;
      await sessions.shutdown();
    },
  };
}
