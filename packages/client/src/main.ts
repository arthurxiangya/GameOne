import { createEmbeddedServer, type EmbeddedServer, type LoopStats } from '@lanternwood/server/embedded';
import { GameClient } from './app/game-client';
import { resolvePlayMode } from './app/play-mode';
import { LoopbackTransport } from './net/loopback-transport';
import type { TransportFactory } from './net/transport';
import { WebSocketTransport } from './net/websocket-transport';
import { browserTime } from './offline/browser-time';
import { LocalStorageLeaderboardRepository } from './offline/local-storage-leaderboard-repository';
import { LocalStoragePlayerRepository, browserStorage } from './offline/local-storage-player-repository';

declare global {
  interface Window {
    /** The running client, for debugging and automated browser checks. */
    lanternwood?: GameClient;
    /** Single-player only: tick timing of the in-page server. */
    lanternwoodServerStats?: () => LoopStats | null;
  }
}

const body = document.body;
const coarsePointer = window.matchMedia?.('(pointer: coarse)').matches ?? false;
if (coarsePointer) body.classList.add('touch');
window.addEventListener(
  'pointerdown',
  (e) => {
    if (e.pointerType === 'touch') body.classList.add('touch');
  },
  true,
);

/** Single-player: the authoritative server runs in this page, created on first connect. */
function offlineTransport(): TransportFactory {
  let server: EmbeddedServer | null = null;
  const getServer = (): EmbeddedServer =>
    (server ??= createEmbeddedServer({
      repository: new LocalStoragePlayerRepository(browserStorage()),
      boards: new LocalStorageLeaderboardRepository(browserStorage()),
      time: browserTime,
    }));
  const save = (): void => void server?.saveAll();
  window.lanternwoodServerStats = () => server?.stats() ?? null;
  window.addEventListener('pagehide', save);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) save();
  });
  return (handlers) => new LoopbackTransport(getServer, handlers);
}

try {
  const mode = resolvePlayMode(window.location, import.meta.env?.VITE_PLAY_MODE);
  const createTransport: TransportFactory =
    mode.kind === 'offline' ? offlineTransport() : (handlers) => new WebSocketTransport(mode.serverUrl, handlers);
  const client = new GameClient({
    createTransport,
    offline: mode.kind === 'offline',
    lowPower: Math.min(window.innerWidth, window.innerHeight) < 700,
    reduceMotion: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
  });
  window.lanternwood = client;
  client.start();
} catch (err) {
  const status = document.getElementById('startStatus');
  if (status) {
    status.classList.add('error');
    status.textContent = `The game could not start: ${err instanceof Error ? err.message : String(err)}`;
  }
  console.error(err);
}
