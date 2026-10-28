import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isLogLevel, type LogLevel } from './infrastructure/logging/json-logger';

export interface ServerConfig {
  readonly host: string;
  readonly port: number;
  readonly dataDir: string;
  readonly clientDist: string;
  readonly worldSeed: number;
  readonly tickRate: number;
  readonly snapshotEveryTicks: number;
  readonly maxPlayers: number;
  readonly interestRadius: number;
  readonly autosaveSeconds: number;
  readonly dayLengthSeconds: number;
  readonly logLevel: LogLevel;
  readonly allowedOrigins: readonly string[];
  /** Salt for hashing guest tokens into account ids. Keep it stable across restarts. */
  readonly tokenSalt: string;
}

export class ConfigError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`Invalid configuration:\n  - ${problems.join('\n  - ')}`);
    this.name = 'ConfigError';
  }
}

type Env = Readonly<Record<string, string | undefined>>;

/** Default client build location, relative to this module (works from src/ under tsx and from dist/). */
const DEFAULT_CLIENT_DIST = fileURLToPath(new URL('../../client/dist', import.meta.url));

/** Reads and validates configuration from environment variables. Fails fast with every problem listed. */
export function loadConfig(env: Env, cwd: string = process.cwd()): ServerConfig {
  const problems: string[] = [];
  const int = (name: string, fallback: number, min: number, max: number): number => {
    const raw = env[name];
    if (raw === undefined || raw === '') return fallback;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < min || value > max) {
      problems.push(`${name} must be an integer between ${min} and ${max} (got "${raw}")`);
      return fallback;
    }
    return value;
  };

  const logLevel = env.LOG_LEVEL ?? 'info';
  if (!isLogLevel(logLevel)) problems.push(`LOG_LEVEL must be one of debug, info, warn, error (got "${logLevel}")`);

  const config: ServerConfig = {
    host: env.HOST || '0.0.0.0',
    port: int('PORT', 8080, 0, 65535),
    dataDir: resolve(cwd, env.DATA_DIR || 'data'),
    clientDist: env.CLIENT_DIST ? resolve(cwd, env.CLIENT_DIST) : DEFAULT_CLIENT_DIST,
    worldSeed: int('WORLD_SEED', 2026, 0, 2 ** 31 - 1),
    tickRate: int('TICK_RATE', 20, 10, 60),
    snapshotEveryTicks: int('SNAPSHOT_EVERY_TICKS', 1, 1, 10),
    maxPlayers: int('MAX_PLAYERS', 64, 1, 10000),
    interestRadius: int('INTEREST_RADIUS', 80, 20, 200),
    autosaveSeconds: int('AUTOSAVE_SECONDS', 30, 5, 3600),
    dayLengthSeconds: int('DAY_LENGTH_SECONDS', 480, 30, 86400),
    logLevel: isLogLevel(logLevel) ? logLevel : 'info',
    allowedOrigins: (env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    tokenSalt: env.TOKEN_SALT || 'lanternwood-realms',
  };
  if (problems.length > 0) throw new ConfigError(problems);
  return config;
}
