import { publicEndpoint, schema as s, type ModuleApiDoc } from '../../modules/04-validation-api/public';

/** OpenAPI contract of the application-level health routes (`src/app/routes/health.routes.ts`, mounted at `/health`). */
export const healthApiDoc: ModuleApiDoc = {
  moduleId: 'app',
  mountPath: '/health',
  tag: { name: 'Health', description: 'Liveness and readiness probes for monitoring and deployment.' },
  operations: [
    {
      method: 'get',
      path: '/',
      operationId: 'getHealth',
      summary: 'Liveness probe',
      description: 'Answers 200 while the process is running. It does not touch any external dependency (database, cache).',
      authorization: publicEndpoint(),
      success: {
        status: 200,
        description: 'The process is alive.',
        data: s.object({ status: s.string({ enum: ['ok'] }), timestamp: s.dateTime({ description: 'Server time (UTC).' }) }, ['status', 'timestamp']),
        example: { status: 'ok', timestamp: '2026-10-15T09:30:00.000Z' },
      },
    },
    {
      method: 'get',
      path: '/ready',
      operationId: 'getReadiness',
      summary: 'Readiness probe',
      description: 'Verifies the database connection. Answers 200 when the database is reachable and 503 otherwise. The 503 body has the same shape with `success: false` (it is not the standard error envelope).',
      authorization: publicEndpoint(),
      success: {
        status: 200,
        description: 'The application is ready to serve traffic.',
        data: s.object(
          { status: s.string({ enum: ['ready'] }), checks: s.object({ database: s.string({ enum: ['up'] }) }, ['database']) },
          ['status', 'checks'],
        ),
        example: { status: 'ready', checks: { database: 'up' } },
      },
      customResponses: {
        503: {
          description: 'The database is not reachable.',
          schema: s.object(
            {
              success: s.boolean({ example: false }),
              data: s.object({ status: s.string({ enum: ['degraded'] }), checks: s.object({ database: s.string({ enum: ['down'] }) }, ['database']) }, ['status', 'checks']),
              requestId: s.string(),
            },
            ['success', 'data'],
          ),
          example: { success: false, data: { status: 'degraded', checks: { database: 'down' } }, requestId: '5d9c2f4e-7a41-4c0e-9d2b-3e8f1a6b7c10' },
        },
      },
    },
  ],
};
