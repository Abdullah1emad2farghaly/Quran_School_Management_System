import { Router, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import { param } from 'express-validator';
import { AppError, type PageResult } from '../../../00-shared-kernel/public';
import { parseListQuery, sendPaginated, sendSuccess, validate, type ListQuerySpec, type ListQuery } from '../../../04-validation-api/public';
import type { RequirePermission } from '../../../12-authorization-engine/public';
import type { AuditRecordDto, AuditViewer } from '../../application/dto/audit-dto';
import type { AuditFilter } from '../../application/ports/audit-repository';
import { AuditPermissions } from '../../application/services/audit-authorization';
import type { AuditQueryService } from '../../application/services/audit-query-service';
import { AUDIT_ACTIONS } from '../../domain/value-objects/audit-action';

export type AuditHandlerService = Pick<AuditQueryService, 'list' | 'get'>;

export interface AuditRouterDeps {
  readonly getService: () => AuditHandlerService;
  /** Authenticates the access token (Module 10 `requireAuthentication`). */
  readonly requireAuthentication: RequestHandler;
  /** Authorization Engine route guard (Module 12). */
  readonly requirePermission: RequirePermission;
}

/** Newest first by default (`sort=timestamp`, `-timestamp`). Every filter only NARROWS what the caller may already see. `from`/`to` are inclusive calendar days in UTC. */
export const AUDIT_LIST_SPEC: ListQuerySpec = {
  sortable: { timestamp: 'timestamp' },
  defaultSort: [{ key: 'timestamp', direction: 'desc' }],
  filters: {
    module: { type: 'string', maxLength: 40 },
    action: { type: 'enum', values: AUDIT_ACTIONS, multiple: true },
    entityType: { type: 'string', maxLength: 80 },
    entityId: { type: 'string', maxLength: 64 },
    actorUserId: { type: 'uuid' },
    organizationId: { type: 'uuid' },
    schoolId: { type: 'uuid' },
    from: { type: 'date' },
    to: { type: 'date' },
  },
};

const DAY_MS = 24 * 3600 * 1000;
const startOfDayUtc = (isoDate: string): Date => new Date(`${isoDate}T00:00:00.000Z`);

/** Maps the validated query to the repository filter. Exported for tests. */
export function auditFilterOf(query: ListQuery): AuditFilter {
  const f = query.filters;
  const str = (key: string): string | undefined => (typeof f[key] === 'string' ? (f[key] as string) : undefined);
  const action = f.action;
  const from = str('from');
  const to = str('to');
  const module = str('module');
  const entityType = str('entityType');
  const entityId = str('entityId');
  const actorUserId = str('actorUserId');
  const organizationId = str('organizationId');
  const schoolId = str('schoolId');
  return {
    ...(module !== undefined ? { module } : {}),
    ...(Array.isArray(action) ? { action: action as readonly string[] } : typeof action === 'string' ? { action: [action] } : {}),
    ...(entityType !== undefined ? { entityType } : {}),
    ...(entityId !== undefined ? { entityId } : {}),
    ...(actorUserId !== undefined ? { actorUserId } : {}),
    ...(organizationId !== undefined ? { organizationId } : {}),
    ...(schoolId !== undefined ? { schoolId } : {}),
    ...(from !== undefined ? { from: startOfDayUtc(from) } : {}),
    ...(to !== undefined ? { to: new Date(startOfDayUtc(to).getTime() + DAY_MS) } : {}),
  };
}

export const serializeAuditRecord = (r: AuditRecordDto) => ({ ...r, timestamp: r.timestamp.toISOString() });

type AsyncHandler = (req: Request, res: Response) => Promise<void>;
const handle =
  (fn: AsyncHandler): RequestHandler =>
  (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res).catch(next);
  };

/** The verified caller and the role its session acts as (both from the access token's session, never from the request). */
function viewerOf(req: Request): AuditViewer {
  if (!req.auth) throw new AppError('AUTHENTICATION_REQUIRED', 'UNAUTHENTICATED');
  return { userId: req.auth.userId, activeRole: req.auth.activeRole };
}

/**
 * /audit-logs: READ-ONLY. There is no endpoint that creates, changes or deletes an audit record (audit is immutable, Master Specification §64).
 *   GET /audit-logs        audit.log.list   MAIN_ADMIN | ORGANIZATION_MANAGER | SCHOOL_MANAGER   the audit records the caller may see (paginated, filters)
 *   GET /audit-logs/:id    audit.log.read   same                                                  one record; one outside the caller's scope answers 404
 * Which records a caller sees: Main Admin all; Organization Manager the organizations they administer; School Manager the schools they manage (by the session's
 * active role). Responses are `Cache-Control: no-store`.
 */
export function createAuditRouter(deps: AuditRouterDeps): Router {
  const router = Router();
  const auth = deps.requireAuthentication;
  const guard = deps.requirePermission;
  const noStore = (res: Response): void => {
    res.setHeader('Cache-Control', 'no-store');
  };

  router.get(
    '/',
    auth,
    guard(AuditPermissions.LIST),
    handle(async (req, res) => {
      const query = parseListQuery(req.query as Record<string, unknown>, AUDIT_LIST_SPEC);
      const page = await deps.getService().list(viewerOf(req), query, auditFilterOf(query));
      noStore(res);
      const result: PageResult<ReturnType<typeof serializeAuditRecord>> = { ...page, items: page.items.map(serializeAuditRecord) };
      sendPaginated(res, result);
    }),
  );

  router.get(
    '/:id',
    auth,
    validate(param('id').isUUID().withMessage('INVALID_VALUE')),
    guard(AuditPermissions.READ),
    handle(async (req, res) => {
      const record = await deps.getService().get(viewerOf(req), req.params.id as string);
      noStore(res);
      sendSuccess(res, serializeAuditRecord(record));
    }),
  );

  return router;
}
