import type { ClientMessage, ServerMessage } from '@lanternwood/shared';

export interface TransportHandlers {
  open(): void;
  message(msg: ServerMessage): void;
  /** The server ended the connection, or it was lost. Not called for `close()`. */
  close(code: number, reason: string): void;
}

/**
 * How the client reaches a game server. The game logic only ever talks to this interface,
 * so online play (WebSocket) and single-player play (an in-page server) share every other line.
 */
export interface Transport {
  readonly isOpen: boolean;
  open(): void;
  send(msg: ClientMessage): void;
  close(): void;
}

export type TransportFactory = (handlers: TransportHandlers) => Transport;
