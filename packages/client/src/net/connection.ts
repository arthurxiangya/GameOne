import { decodeServerMessage, encodeMessage, type ClientMessage, type ServerMessage } from '@lanternwood/shared';

export interface ConnectionHandlers {
  open(): void;
  message(msg: ServerMessage): void;
  close(code: number, reason: string): void;
}

/** Thin, typed wrapper around the browser WebSocket. Reconnect policy lives in the app layer. */
export class Connection {
  private socket: WebSocket | null = null;

  constructor(
    private readonly url: string,
    private readonly handlers: ConnectionHandlers,
  ) {}

  get isOpen(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  open(): void {
    this.close();
    const socket = new WebSocket(this.url);
    this.socket = socket;
    socket.addEventListener('open', () => {
      if (this.socket === socket) this.handlers.open();
    });
    socket.addEventListener('message', (event: MessageEvent) => {
      if (this.socket !== socket || typeof event.data !== 'string') return;
      const msg = decodeServerMessage(event.data);
      if (msg) this.handlers.message(msg);
    });
    socket.addEventListener('close', (event: CloseEvent) => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.handlers.close(event.code, event.reason);
    });
  }

  send(msg: ClientMessage): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(encodeMessage(msg));
  }

  close(): void {
    const socket = this.socket;
    this.socket = null;
    if (socket && socket.readyState <= WebSocket.OPEN) socket.close(1000, 'Client closed');
  }
}
