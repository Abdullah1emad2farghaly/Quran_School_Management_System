import { closeDatabase } from '../config/database';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { startOutbox, stopOutbox } from '../config/outbox';
import { registerSessionEventHandlers } from '../config/sessions';
import { createApp } from './bootstrap/create-app';

const app = createApp();
const server = app.listen(env.port, () => {
  logger.info('server listening', { port: env.port, environment: env.nodeEnv });
});
registerSessionEventHandlers();
startOutbox();

async function shutdown(signal: string): Promise<void> {
  logger.info('shutting down', { signal });
  await stopOutbox();
  server.close(async () => {
    await closeDatabase();
    process.exit(0);
  });
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
