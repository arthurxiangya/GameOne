import { GameClient } from './app/game-client';
import { resolveServerUrl } from './app/server-url';

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

try {
  const client = new GameClient({
    serverUrl: resolveServerUrl(window.location),
    lowPower: Math.min(window.innerWidth, window.innerHeight) < 700,
    reduceMotion: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
  });
  client.start();
} catch (err) {
  const status = document.getElementById('startStatus');
  if (status) {
    status.classList.add('error');
    status.textContent = `The game could not start: ${err instanceof Error ? err.message : String(err)}`;
  }
  console.error(err);
}
