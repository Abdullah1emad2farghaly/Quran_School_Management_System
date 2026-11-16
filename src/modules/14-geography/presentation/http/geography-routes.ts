import { Router, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import { query, type ValidationChain } from 'express-validator';
import { isUuid } from '../../../00-shared-kernel/public';
import { sendSuccess, validate } from '../../../04-validation-api/public';
import type { GeographyLookup } from '../../application/services/geography-service';
import { createGeographyHandlers, type SubmissionOrganizationLookup } from './geography-handlers';

export interface GeographyRouterDeps {
  readonly getGeography: () => Pick<GeographyLookup, 'getCountry' | 'listActiveCountries' | 'listActiveGovernorates'>;
  /** Module 13's read-only registration lookup (the organization's country is derived from the database). */
  readonly getOrganizations: () => SubmissionOrganizationLookup;
}

const handle =
  (fn: (req: Request, res: Response) => Promise<void>): RequestHandler =>
  (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res).catch(next);
  };

const present = (value: unknown): boolean => value !== undefined;

/**
 * `countryId` / `organizationId`: EXACTLY ONE of the two must be sent (neither -> REQUIRED_FIELD, both -> INVALID_VALUE) and it must be a UUID
 * (anything else, including a repeated parameter, -> INVALID_VALUE). Done in one `custom` check on purpose: `optional()` would skip it.
 */
const filter = (field: 'countryId' | 'organizationId', other: 'countryId' | 'organizationId'): ValidationChain =>
  query(field).custom((value: unknown, { req }) => {
    const otherValue = (req as Request).query[other];
    if (!present(value) && !present(otherValue)) throw new Error('REQUIRED_FIELD');
    if (present(value) && present(otherValue)) throw new Error('INVALID_VALUE');
    if (present(value) && !(typeof value === 'string' && isUuid(value))) throw new Error('INVALID_VALUE');
    return true;
  });

/**
 * /geography: PUBLIC, read-only registration lookups (no authentication, no permission: the data is global reference data and only `{ id, name }` leaves).
 *   GET /geography/countries                                       the ACTIVE countries
 *   GET /geography/governorates?countryId=... | ?organizationId=...  the ACTIVE governorates of a country, or of the country of an organization that may receive school submissions
 * It reuses `GeographyService` (the one source of geographic data) and Module 13's read-only organization lookup; it creates, changes and deletes nothing.
 */
export function createGeographyRouter(deps: GeographyRouterDeps): Router {
  const router = Router();
  const h = createGeographyHandlers(deps.getGeography, deps.getOrganizations);

  router.get('/countries', handle(async (_req, res) => sendSuccess(res, await h.listCountries())));

  router.get(
    '/governorates',
    validate(filter('countryId', 'organizationId'), filter('organizationId', 'countryId')),
    handle(async (req, res) => {
      const { countryId, organizationId } = req.query as { countryId?: string; organizationId?: string };
      sendSuccess(res, await h.listGovernorates({ ...(countryId !== undefined ? { countryId } : {}), ...(organizationId !== undefined ? { organizationId } : {}) }));
    }),
  );

  return router;
}
