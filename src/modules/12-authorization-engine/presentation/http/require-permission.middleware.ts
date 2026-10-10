import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { RoleCode } from '../../../09-roles-permissions/public';
import { sessionError } from '../../../10-sessions-jwt/public';
import type { Authorizer } from '../../application/services/authorizer';
import type { ResourceRef, ScopeTarget } from '../../domain/value-objects/entity-ref';

declare module 'express-serve-static-core' {
  interface Request {
    /** Set by `requirePermission` once the request is authorized: which permission, and through which active role. */
    authorization?: { readonly permission: string; readonly role: RoleCode };
  }
}

export interface RequirePermissionOptions {
  /**
   * WHERE the operation happens (required for scoped permissions, omitted for UNSCOPED ones). Resolve it from server-side
   * data (load the resource through its owning module's public contract); never use a scope/school id the client claims.
   * Throwing (for example NOT_FOUND from the owning module) is forwarded to the error handler unchanged.
   */
  readonly target?: (req: Request) => ScopeTarget | Promise<ScopeTarget>;
  /** WHAT is acted on (required when the permission has ownership roles). Same rules as `target`. */
  readonly resource?: (req: Request) => ResourceRef | Promise<ResourceRef>;
}

export type RequirePermission = (permission: string, options?: RequirePermissionOptions) => RequestHandler;

/**
 * Express guard: `router.post('/x', requireAuthentication, requirePermission('module.resource.action', {...}), handler)`.
 *
 * Fails closed: without `req.auth` (authentication middleware missing or failed) the answer is 401, never "allowed". A
 * denial is 403 ACCESS_DENIED with no reason. Authorization is evaluated on every request against current data.
 */
export function createRequirePermission(getAuthorizer: () => Authorizer): RequirePermission {
  return (permission, options = {}) =>
    async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
      try {
        const auth = req.auth;
        if (!auth) throw sessionError('AUTHENTICATION_REQUIRED');

        const target = options.target ? await options.target(req) : undefined;
        const resource = options.resource ? await options.resource(req) : undefined;
        const role = await getAuthorizer().assertAuthorized({ userId: auth.userId, permission, target, resource });

        req.authorization = { permission, role };
        next();
      } catch (error) {
        next(error);
      }
    };
}
