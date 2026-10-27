import { randomUUID } from 'node:crypto';
import type { IncomingMessage, Server } from 'node:http';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import type { ClientLink, Logger } from '../../application/ports';

export interface GatewayHandlers {
  onConnect(link: ClientLink): void;
  onMessage(link: ClientLink, text: string): void;
  onDisconnect(link: ClientLink): void;
}

export interface GatewayOptions {
  readonly path: string;
  readonly maxPayloadBytes: number;
  readonly heartbeatSeconds: number;
  /** Empty means any origin is accepted. */
  readonly allowedOrigins: readonly string[];
}

class WebSocketLink implements ClientLink {
  alive = true;

  constructor(
    readonly id: string,
    readonly remoteAddress: string,
    private readonly socket: WebSocket,
  ) {}

  send(text: string): void {
    if (this.socket.readyState === this.socket.OPEN) this.socket.send(text);
  }

  close(code: number, reason: string): void {
    // Close reasons are limited to 123 bytes by the WebSocket spec.
    this.socket.close(code, reason.slice(0, 120));
  }

  bufferedBytes(): number {
    return this.socket.bufferedAmount;
  }
}

/** WebSocket adapter: turns sockets into ClientLinks and drops connections that stop answering pings. */
export class WebSocketGateway {
  private readonly server: WebSocketServer;
  private readonly links = new Map<WebSocket, WebSocketLink>();
  private heartbeat: NodeJS.Timeout | null = null;

  constructor(
    httpServer: Server,
    private readonly options: GatewayOptions,
    private readonly handlers: GatewayHandlers,
    private readonly logger: Logger,
  ) {
    this.server = new WebSocketServer({
      server: httpServer,
      path: options.path,
      maxPayload: options.maxPayloadBytes,
      perMessageDeflate: false,
      verifyClient: (info: { origin: string }) => this.originAllowed(info.origin),
    });
    this.server.on('connection', (socket: WebSocket, request: IncomingMessage) => this.accept(socket, request));
    this.server.on('error', (err: Error) => this.logger.error('websocket server error', { error: err.message }));
  }

  start(): void {
    this.heartbeat = setInterval(() => this.sweep(), this.options.heartbeatSeconds * 1000);
    this.heartbeat.unref();
  }

  async close(): Promise<void> {
    if (this.heartbeat) clearInterval(this.heartbeat);
    for (const socket of this.links.keys()) socket.terminate();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  get connections(): number {
    return this.links.size;
  }

  private accept(socket: WebSocket, request: IncomingMessage): void {
    const link = new WebSocketLink(randomUUID(), remoteAddressOf(request), socket);
    this.links.set(socket, link);
    socket.on('pong', () => {
      link.alive = true;
    });
    socket.on('message', (data: RawData, isBinary: boolean) => {
      if (isBinary) {
        link.close(1003, 'Binary frames are not supported.');
        return;
      }
      this.handlers.onMessage(link, rawToText(data));
    });
    socket.on('close', () => {
      this.links.delete(socket);
      this.handlers.onDisconnect(link);
    });
    socket.on('error', (err: Error) => this.logger.debug('socket error', { link: link.id, error: err.message }));
    this.handlers.onConnect(link);
  }

  private sweep(): void {
    for (const [socket, link] of this.links) {
      if (!link.alive) {
        socket.terminate();
        continue;
      }
      link.alive = false;
      socket.ping();
    }
  }

  private originAllowed(origin: string | undefined): boolean {
    if (this.options.allowedOrigins.length === 0) return true;
    return origin !== undefined && this.options.allowedOrigins.includes(origin);
  }
}

function rawToText(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  return data.toString('utf8');
}

function remoteAddressOf(request: IncomingMessage): string {
  const forwarded = request.headers['x-forwarded-for'];
  const first = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0];
  return (first ?? request.socket.remoteAddress ?? 'unknown').trim();
}
