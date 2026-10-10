import type { RoleCode } from '../../../09-roles-permissions/public';
import type { AuthorizationDecision } from '../../domain/value-objects/authorization-decision';
import type { ResourceRef, ScopeTarget } from '../../domain/value-objects/entity-ref';

export interface AuthorizationRequest {
  /** The authenticated caller (`req.auth.userId`). Never a value taken from the request body. */
  readonly userId: string;
  readonly permission: string;
  /**
   * WHERE the operation is performed. Required when the permission is scoped, and must be omitted when it is
   * UNSCOPED. Build it from server-side data (the resource's real school/geography), not from client-claimed ids.
   */
  readonly target?: ScopeTarget;
  /** WHAT is acted on, for ownership. Required when the permission has ownership roles, otherwise omitted. */
  readonly resource?: ResourceRef;
}

/**
 * The contract other modules depend on (inject this, never the concrete service).
 *
 * `authorize` answers; `assertAuthorized` throws ACCESS_DENIED (403) and returns the role that authorized the action,
 * for role-dependent business rules. Passing the authorization is only the FIRST part of a protected action: business
 * rules, schedule and Smart Guard checks still follow (Master Specification §20).
 */
export interface Authorizer {
  authorize(request: AuthorizationRequest): Promise<AuthorizationDecision>;
  assertAuthorized(request: AuthorizationRequest): Promise<RoleCode>;
}
