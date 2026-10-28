import { resolveServerUrl } from './server-url';

export type PlayMode = { readonly kind: 'online'; readonly serverUrl: string } | { readonly kind: 'offline' };

/**
 * Decides whether this page plays online or single-player.
 * `?offline` forces single-player, `?server=wss://…` forces online against that server,
 * and otherwise the build decides (`VITE_PLAY_MODE=offline` produces the single-player preview).
 */
export function resolvePlayMode(location: Pick<Location, 'protocol' | 'host' | 'search'>, buildMode: string | undefined): PlayMode {
  const params = new URLSearchParams(location.search);
  if (params.has('offline')) return { kind: 'offline' };
  if (params.has('server') || buildMode !== 'offline') return { kind: 'online', serverUrl: resolveServerUrl(location) };
  return { kind: 'offline' };
}
