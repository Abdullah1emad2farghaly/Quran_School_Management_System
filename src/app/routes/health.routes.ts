import { Router } from 'express';
import { checkDatabase } from '../../config/database';

export const healthRouter = Router();

/** Liveness: does not touch external dependencies. */
healthRouter.get('/', (req, res) => {
  res.json({
    success: true,
    data: { status: 'ok', timestamp: new Date().toISOString() },
    requestId: req.requestId,
  });
});

/** Readiness: verifies the database connection. */
healthRouter.get('/ready', async (req, res) => {
  const database = await checkDatabase();
  res.status(database ? 200 : 503).json({
    success: database,
    data: { status: database ? 'ready' : 'degraded', checks: { database: database ? 'up' : 'down' } },
    requestId: req.requestId,
  });
});
