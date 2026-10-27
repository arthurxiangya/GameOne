import type { LogFields, Logger } from '../../application/ports';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
export type LogLevel = keyof typeof LEVELS;

export const isLogLevel = (value: string): value is LogLevel => value in LEVELS;

export type LogSink = (line: string, level: LogLevel) => void;

const defaultSink: LogSink = (line, level) => {
  if (level === 'error' || level === 'warn') process.stderr.write(`${line}\n`);
  else process.stdout.write(`${line}\n`);
};

/** Structured logger that writes one JSON object per line, ready for any log shipper. */
export function createJsonLogger(minLevel: LogLevel, base: LogFields = {}, sink: LogSink = defaultSink): Logger {
  const write = (level: LogLevel, message: string, fields?: LogFields): void => {
    if (LEVELS[level] < LEVELS[minLevel]) return;
    sink(JSON.stringify({ time: new Date().toISOString(), level, message, ...base, ...fields }), level);
  };
  return {
    debug: (m, f) => write('debug', m, f),
    info: (m, f) => write('info', m, f),
    warn: (m, f) => write('warn', m, f),
    error: (m, f) => write('error', m, f),
    child: (fields) => createJsonLogger(minLevel, { ...base, ...fields }, sink),
  };
}
