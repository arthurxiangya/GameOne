/**
 * The game socket lives on the page's own origin at /ws. A `?server=wss://host/ws` query
 * parameter points the client at another server (handy for testing against production).
 */
export function resolveServerUrl(location: Pick<Location, 'protocol' | 'host' | 'search'>): string {
  const override = new URLSearchParams(location.search).get('server');
  if (override && /^wss?:\/\/[^\s]+$/.test(override)) return override;
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${scheme}://${location.host}/ws`;
}
