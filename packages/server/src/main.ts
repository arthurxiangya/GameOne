import { createGameServer } from './app';
import { ConfigError, loadConfig } from './config';
import { createJsonLogger } from './infrastructure/logging/json-logger';
import { JsonFilePlayerRepository } from './infrastructure/persistence/json-file-player-repository';
import { systemTime } from './infrastructure/time/system-time';

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const logger = createJsonLogger(config.logLevel, { service: 'lanternwood-server' });

  const repository = new JsonFilePlayerRepository(config.dataDir);
  await repository.init();

  const server = createGameServer({ config, logger, time: systemTime, repository });
  const port = await server.listen();
  logger.info('server listening', { host: config.host, port, seed: config.worldSeed, tickRate: config.tickRate, data: config.dataDir });

  let stopping = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (stopping) return;
    stopping = true;
    logger.info('shutting down', { signal });
    const force = setTimeout(() => {
      logger.error('shutdown timed out; exiting');
      process.exit(1);
    }, 10_000);
    force.unref();
    await server.stop();
    logger.info('shutdown complete');
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => {
    logger.error('unhandled promise rejection', { error: reason instanceof Error ? reason.stack : String(reason) });
  });
}

main().catch((err: unknown) => {
  if (err instanceof ConfigError) console.error(err.message);
  else console.error(err);
  process.exit(1);
});
