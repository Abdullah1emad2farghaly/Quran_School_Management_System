import cors from 'cors';
import express, { type Express } from 'express';
import { env } from '../../config/env';
import { logger } from '../../config/logger';
import { createRequestLogger } from '../../modules/05-logging-request-context/public';
import { errorHandler, notFoundHandler } from '../middleware/error-handler.middleware';
import { requestContextMiddleware } from '../middleware/request-context.middleware';
import { API_BASE_PATH, buildApiRouter } from '../routes';
import { registerAllErrorMessages } from './register-error-messages';
import { applyTrustedProxies } from './trusted-proxies';

export function createApp(): Express {
  registerAllErrorMessages();

  const app = express();
  app.disable('x-powered-by');
  applyTrustedProxies(app, env.http.trustedProxies);

  app.use(requestContextMiddleware);
  app.use(createRequestLogger(logger));
  app.use(
    cors({
      origin: env.corsOrigins.length ? [...env.corsOrigins] : false,
      exposedHeaders: ['X-Request-Id'],
    }),
  );
  app.use(express.json({ limit: '1mb' }));

  app.use(API_BASE_PATH, buildApiRouter());

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
