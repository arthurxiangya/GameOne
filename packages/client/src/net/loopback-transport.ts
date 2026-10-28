import { decodeServerMessage, encodeMessage, type ClientMessage } from '@lanternwood/shared';
import type { ClientLink, EmbeddedConnection, EmbeddedServer } from '@lanternwood/server/embedded';
import type { Transport, TransportHandlers } from './transport';

class LoopbackLink implements ClientLink {
  readonly remoteAddress = 'local';
  open = true;

  constructor(
    readonly id: string,
    private readonly deliver: (text: string) => void,
    private readonly closed: (code: number, reason: string) => void,
  ) {}

  send(text: string): void {
    if (this.open) this.deliver(text);
  }

  close(code: number, reason: string): void {
    if (!this.open) return;
    this.open = false;
    this.closed(code, reason);
  }

  bufferedBytes(): number {
    return 0;
  }
}

/**
 * Single-player play: connects to a game server running in the same page. Messages still
 * travel as JSON text and arrive asynchronously, in order, exactly as they would over a
 * WebSocket, so the client exercises the same protocol code online and offline.
 */
export class LoopbackTransport implements Transport {
  private link: LoopbackLink | null = null;
  private connection: EmbeddedConnection | null = null;
  private nextId = 1;

  /** `server` is called on first use, so the in-page server only starts when someone plays. */
  constructor(
    private readonly server: () => EmbeddedServer,
    private readonly handlers: TransportHandlers,
  ) {}

  get isOpen(): boolean {
    return this.connection !== null;
  }

  open(): void {
    this.close();
    const link: LoopbackLink = new LoopbackLink(
      `local-${this.nextId++}`,
      (text) =>
        queueMicrotask(() => {
          if (this.link !== link) return;
          const msg = decodeServerMessage(text);
          if (msg) this.handlers.message(msg);
        }),
      (code, reason) =>
        queueMicrotask(() => {
          if (this.link !== link) return;
          const connection = this.connection;
          this.link = null;
          this.connection = null;
          void connection?.disconnect();
          this.handlers.close(code, reason);
        }),
    );
    this.link = link;
    this.connection = this.server().connect(link);
    setTimeout(() => {
      if (this.link === link) this.handlers.open();
    }, 0);
  }

  send(msg: ClientMessage): void {
    this.connection?.receive(encodeMessage(msg));
  }

  close(): void {
    const link = this.link;
    const connection = this.connection;
    this.link = null;
    this.connection = null;
    if (link) link.open = false;
    void connection?.disconnect();
  }
}
