/** Ports the application layer needs from the outside world. */

export type LogFields = Readonly<Record<string, unknown>>;

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  child(fields: LogFields): Logger;
}

export const nullLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => nullLogger,
};

export interface SystemTime {
  /** Monotonic seconds, for rate limits and timers. */
  monotonic(): number;
  /** Wall-clock timestamp for persisted records. */
  iso(): string;
}

/** One connected client, whatever the transport. */
export interface ClientLink {
  readonly id: string;
  readonly remoteAddress: string;
  send(text: string): void;
  close(code: number, reason: string): void;
  /** Bytes queued but not yet flushed to the socket; used for backpressure. */
  bufferedBytes(): number;
}

/** Turns a client's secret token into a stable, non-reversible account id. */
export type TokenHasher = (token: string) => string;
