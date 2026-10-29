import type { ClientMessage, ServerMessage, ServerMessageType } from './messages';

export const encodeMessage = (msg: ClientMessage | ServerMessage): string => JSON.stringify(msg);

/** Parses JSON text, returning undefined for oversized or malformed input. */
export function decodeJson(text: string, maxBytes: number): unknown {
  if (text.length > maxBytes) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** Every server message type. A Record, so adding a type without listing it here fails to compile. */
const SERVER_TYPES: Readonly<Record<ServerMessageType, true>> = {
  welcome: true, reject: true, snapshot: true, progress: true, mode: true, boards: true, chat: true, system: true, error: true, pong: true,
};

/**
 * Light structural check for messages from the (trusted) server. The client only
 * guards against garbage; the server is the authority on content.
 */
export function decodeServerMessage(text: string): ServerMessage | null {
  const data = decodeJson(text, 4 * 1024 * 1024);
  if (typeof data !== 'object' || data === null) return null;
  const t = (data as { t?: unknown }).t;
  return typeof t === 'string' && Object.hasOwn(SERVER_TYPES, t) ? (data as ServerMessage) : null;
}
