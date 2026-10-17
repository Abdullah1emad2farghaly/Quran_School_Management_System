import cors from 'cors';
import express, { type Express } from 'express';
import { env } from '../../config/env';
import { logger } from '../../config/logger';
import { createRequestLogger } from '../../modules/05-logging-request-context/public';
import { mountApiDocs } from '../openapi/serve-api-docs';
import { errorHandler, notFoundHandler } from '../middleware/error-handler.middleware';
import { requestContextMiddleware } from '../middleware/request-context.middleware';
import { API_BASE_PATH, buildApiRouter } from '../routes';
import { registerAllErrorMessages } from './register-error-messages';
import { applyTrustedProxies } from './trusted-proxies';

export interface CreateAppOptions {
  /** Overrides `API_DOCS_ENABLED` (tests). */
  readonly apiDocsEnabled?: boolean;
}

export function createApp(options: CreateAppOptions = {}): Express {
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

  // Swagger UI and the raw OpenAPI document: outside the API base path; off in production unless API_DOCS_ENABLED=true.
  mountApiDocs(app, { enabled: options.apiDocsEnabled ?? env.apiDocs.enabled });

  app.use(API_BASE_PATH, buildApiRouter());

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
