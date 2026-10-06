import { closeDatabase } from '../config/database';
import { env } from '../config/env';
import { createApp } from './bootstrap/create-app';

const app = createApp();
const server = app.listen(env.port, () => {
  // eslint-disable-next-line no-console
  console.log(`Quran School Management System listening on :${env.port} (${env.nodeEnv})`);
});

async function shutdown(signal: string): Promise<void> {
  // eslint-disable-next-line no-console
  console.log(`${signal} received, shutting down`);
  server.close(async () => {
    await closeDatabase();
    process.exit(0);
  });
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
