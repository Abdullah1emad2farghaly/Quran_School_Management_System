import { Router } from 'express';
import { healthRouter } from './health.routes';

export const API_BASE_PATH = '/api/v1';

/** Module routers are mounted here as their phases are implemented. */
export function buildApiRouter(): Router {
  const router = Router();
  router.use('/health', healthRouter);
  return router;
}
