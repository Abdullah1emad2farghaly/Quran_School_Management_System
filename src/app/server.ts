import { closeDatabase } from '../config/database';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { registerAttendanceEventHandlers } from '../config/attendance';
import { registerClassSessionEventHandlers, startClassSessionScheduler, stopClassSessionScheduler } from '../config/class-sessions';
import { registerExamEventHandlers, startExamScheduler, stopExamScheduler } from '../config/exams';
import { registerNotificationEventHandlers, startPushDeliveryScheduler, stopPushDeliveryScheduler } from '../config/notifications';
import { registerNotificationRuleHandlers, startReminderScheduler, stopReminderScheduler } from '../config/notification-rules';
import { startOutbox, stopOutbox } from '../config/outbox';
import { registerSessionEventHandlers, startSessionExpiryScheduler, stopSessionExpiryScheduler } from '../config/sessions';
import { createApp } from './bootstrap/create-app';

const app = createApp();
const server = app.listen(env.port, () => {
  logger.info('server listening', { port: env.port, environment: env.nodeEnv });
  if (env.apiDocs.enabled) logger.info('api documentation enabled', { swaggerUi: '/api-docs', openApi: '/api-docs.json' });
});
registerSessionEventHandlers();
registerClassSessionEventHandlers();
registerAttendanceEventHandlers();
registerExamEventHandlers();
registerNotificationEventHandlers();
registerNotificationRuleHandlers();
startOutbox();
startClassSessionScheduler();
startExamScheduler();
startPushDeliveryScheduler();
startReminderScheduler();
startSessionExpiryScheduler();

async function shutdown(signal: string): Promise<void> {
  logger.info('shutting down', { signal });
  stopSessionExpiryScheduler();
  stopPushDeliveryScheduler();
  stopReminderScheduler();
  stopExamScheduler();
  await stopClassSessionScheduler();
  await stopOutbox();
  server.close(async () => {
    await closeDatabase();
    process.exit(0);
  });
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
