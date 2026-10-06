import { createLogger } from '../modules/05-logging-request-context/public';
import { env } from './env';

/** Application-wide logger (composition root). Level comes from LOG_LEVEL. */
export const logger = createLogger({ level: env.logLevel, bindings: { service: 'qsms' } });
