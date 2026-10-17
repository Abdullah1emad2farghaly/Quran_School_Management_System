import type { Express } from 'express';
import swaggerUi from 'swagger-ui-express';
import { logger } from '../../config/logger';
import type { OpenApiDocument } from '../../modules/04-validation-api/public';
import { API_TITLE, buildApiDocument } from './api-documents';

export const API_DOCS_PATH = '/api-docs';
export const API_DOCS_JSON_PATH = '/api-docs.json';

export interface MountApiDocsOptions {
  /** From configuration (`API_DOCS_ENABLED`): on outside production, off in production unless explicitly enabled. */
  readonly enabled: boolean;
  /** Test seam; defaults to the real document. */
  readonly buildDocument?: () => OpenApiDocument;
}

/**
 * Serves Swagger UI at `/api-docs` and the raw OpenAPI document at `/api-docs.json`, OUTSIDE the API base path.
 * Returns whether they were mounted. A documentation failure is logged and never prevents the application from starting.
 */
export function mountApiDocs(app: Express, options: MountApiDocsOptions): boolean {
  if (!options.enabled) return false;
  let document: OpenApiDocument;
  try {
    document = (options.buildDocument ?? buildApiDocument)();
  } catch (error) {
    logger.error('API documentation could not be built; it is not served', { err: error });
    return false;
  }
  app.get(API_DOCS_JSON_PATH, (_req, res) => {
    res.json(document);
  });
  app.use(
    API_DOCS_PATH,
    swaggerUi.serve,
    swaggerUi.setup(document, {
      customSiteTitle: API_TITLE,
      swaggerOptions: { persistAuthorization: true, displayRequestDuration: true, filter: true, docExpansion: 'list' },
    }),
  );
  return true;
}
