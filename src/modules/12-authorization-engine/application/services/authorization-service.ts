import { AppError } from '../../../00-shared-kernel/public';
import type { IdentityService } from '../../../08-identity-core/public';
import {
  isAssignableRole,
  type PermissionRegistry,
  type RoleCode,
  type RoleService,
} from '../../../09-roles-permissions/public';
import type { Logger } from '../../../05-logging-request-context/public';
import { authorizationError } from '../../domain/errors/authorization-errors';
import {
  allow,
  deny,
  type AuthorizationDecision,
  type DenyReason,
} from '../../domain/value-objects/authorization-decision';
import type { AuthorizationPolicy } from '../../domain/value-objects/authorization-policy';
import { isEntityRef } from '../../domain/value-objects/entity-ref';
import type { ScopeKind } from '../../domain/value-objects/scope-kind';
import type { AuthorizationRequest, Authorizer } from './authorizer';
import type { AuthorizationPolicyRegistry } from './authorization-policy-registry';
import type { AuthorizationResolvers } from './authorization-resolvers';

/**
 * Roles with GLOBAL scope, per scope kind. This is configuration, not engine logic: the composition root decides it
 * (docs/AUTHORIZATION-MATRIX.md records the status of each decision). A global role still needs the permission itself:
 * scope never grants a permission. Management and reporting are listed separately on purpose.
 */
export type GlobalScopeRoles = Readonly<Record<ScopeKind, readonly RoleCode[]>>;

export const NO_GLOBAL_SCOPE: GlobalScopeRoles = Object.freeze({ MANAGEMENT: [], REPORTING: [] });

export interface AuthorizationServiceDeps {
  readonly identity: Pick<IdentityService, 'findById'>;
  readonly roles: Pick<RoleService, 'listActiveRoles'>;
  readonly permissions: PermissionRegistry;
  readonly policies: AuthorizationPolicyRegistry;
  readonly resolvers: AuthorizationResolvers;
  readonly globalScopeRoles?: GlobalScopeRoles;
  readonly logger?: Logger;
}

/**
 * The authorization engine (Master Specification §20): Roles -> Permissions -> Scope -> Ownership. It fails closed.
 *
 *  1. The request must be well formed and match the permission's policy (scope target / ownership resource present
 *     exactly when the policy needs them).
 *  2. The permission must be registered WITH a policy. Unknown permission: denied.
 *  3. The user must exist and be ACTIVE. Checked on every call (no caching), so deactivation takes effect at once.
 *  4. The user's ACTIVE role assignments are read from Module 09 (revoked ones never count).
 *  5. Only roles that the permission is granted to are candidates. A role never gains a permission implicitly.
 *  6. For each candidate role, scope (of the policy's kind) and, where required, ownership must hold UNDER THAT SAME
 *     ROLE. Scope held through one role does not authorize an action granted to another role.
 *  7. Allowed if any candidate role passes. Anything unresolved, missing, non-boolean or throwing is a denial.
 *
 * Failures of the identity/role services themselves (for example the database being down) are NOT swallowed: they
 * propagate as errors, so there is no way to turn an outage into an allow.
 */
export class AuthorizationService implements Authorizer {
  private readonly identity: AuthorizationServiceDeps['identity'];
  private readonly roles: AuthorizationServiceDeps['roles'];
  private readonly permissions: PermissionRegistry;
  private readonly policies: AuthorizationPolicyRegistry;
  private readonly resolvers: AuthorizationResolvers;
  private readonly globalScopeRoles: GlobalScopeRoles;
  private readonly logger: Logger | undefined;

  constructor(deps: AuthorizationServiceDeps) {
    this.identity = deps.identity;
    this.roles = deps.roles;
    this.permissions = deps.permissions;
    this.policies = deps.policies;
    this.resolvers = deps.resolvers;
    this.globalScopeRoles = deps.globalScopeRoles ?? NO_GLOBAL_SCOPE;
    this.logger = deps.logger?.child({ module: 'authorization' });
  }

  async authorize(request: AuthorizationRequest): Promise<AuthorizationDecision> {
    const decision = await this.evaluate(request);
    if (!decision.allowed) {
      // Reasons go to the log only (never to the client). No tokens, passwords or request bodies are involved.
      this.logger?.info('authorization denied', {
        reason: decision.reason,
        permission: typeof request?.permission === 'string' ? request.permission : undefined,
        userId: typeof request?.userId === 'string' ? request.userId : undefined,
      });
    }
    return decision;
  }

  async assertAuthorized(request: AuthorizationRequest): Promise<RoleCode> {
    const decision = await this.authorize(request);
    if (!decision.allowed) throw authorizationError('ACCESS_DENIED');
    return decision.role;
  }

  private async evaluate(request: AuthorizationRequest): Promise<AuthorizationDecision> {
    if (
      typeof request !== 'object' ||
      request === null ||
      typeof request.userId !== 'string' ||
      request.userId === '' ||
      typeof request.permission !== 'string' ||
      request.permission === ''
    ) {
      return deny('INVALID_REQUEST');
    }

    const policy = this.policies.get(request.permission);
    if (!policy || !this.permissions.isRegistered(policy.code)) return deny('PERMISSION_NOT_REGISTERED');

    // The request must carry exactly what the policy asks for: a missing scope/ownership input is never "no restriction".
    const needsTarget = policy.scope !== 'UNSCOPED';
    if (needsTarget !== (request.target !== undefined)) return deny('INVALID_REQUEST');
    if (needsTarget && !isEntityRef(request.target)) return deny('INVALID_REQUEST');
    const needsResource = policy.ownershipRequiredFor.length > 0;
    if (needsResource !== (request.resource !== undefined)) return deny('INVALID_REQUEST');
    if (needsResource && !isEntityRef(request.resource)) return deny('INVALID_REQUEST');

    const user = await this.identity.findById(request.userId);
    if (!user) return deny('USER_NOT_FOUND');
    if (!user.isActive) return deny('USER_INACTIVE');

    const activeRoles = (await this.roles.listActiveRoles(request.userId)).filter(isAssignableRole);
    if (activeRoles.length === 0) return deny('NO_ACTIVE_ROLE');

    const granted = new Set(this.permissions.rolesGranting(policy.code));
    const candidates = activeRoles.filter((role) => granted.has(role));
    if (candidates.length === 0) return deny('PERMISSION_NOT_GRANTED');

    let firstFailure: DenyReason | undefined;
    for (const role of candidates) {
      const failure = await this.checkRole(role, policy, request);
      if (failure === null) return allow(role);
      firstFailure ??= failure;
    }
    return deny(firstFailure ?? 'PERMISSION_NOT_GRANTED');
  }

  /** `null` = this role passes scope and ownership; otherwise the reason it does not. */
  private async checkRole(role: RoleCode, policy: AuthorizationPolicy, request: AuthorizationRequest): Promise<DenyReason | null> {
    if (policy.scope !== 'UNSCOPED') {
      const kind = policy.scope;
      const target = request.target;
      if (!target) return 'INVALID_REQUEST';
      if (!this.globalScopeRoles[kind].includes(role)) {
        const resolver = this.resolvers.scopeResolverFor(kind, target.type);
        if (!resolver) return 'SCOPE_RESOLVER_MISSING';
        try {
          // Strictly `true`: a truthy non-boolean from a faulty resolver is not proof.
          if ((await resolver.covers({ userId: request.userId, role, kind, target })) !== true) return 'SCOPE_NOT_COVERED';
        } catch (error) {
          this.logResolverFailure('scope', error, policy.code);
          return 'SCOPE_RESOLUTION_FAILED';
        }
      }
    }

    if (policy.ownershipRequiredFor.includes(role)) {
      const resource = request.resource;
      if (!resource) return 'OWNERSHIP_RESOURCE_MISSING';
      const resolver = this.resolvers.ownershipResolverFor(resource.type);
      if (!resolver) return 'OWNERSHIP_RESOLVER_MISSING';
      try {
        if ((await resolver.isOwner({ userId: request.userId, role, resource })) !== true) return 'OWNERSHIP_NOT_SATISFIED';
      } catch (error) {
        this.logResolverFailure('ownership', error, policy.code);
        return 'OWNERSHIP_RESOLUTION_FAILED';
      }
    }
    return null;
  }

  private logResolverFailure(kind: 'scope' | 'ownership', error: unknown, permission: string): void {
    // Error name/code only: a resolver's message could contain data we should not log.
    const errorName = error instanceof AppError ? error.code : error instanceof Error ? error.name : 'UnknownError';
    this.logger?.error(`${kind} resolver failed; access denied`, { permission, errorName });
  }
}
