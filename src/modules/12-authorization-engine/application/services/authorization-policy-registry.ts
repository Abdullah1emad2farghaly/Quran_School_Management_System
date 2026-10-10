import type { PermissionRegistry, RoleCode } from '../../../09-roles-permissions/public';
import { authorizationConfigError } from '../../domain/errors/authorization-errors';
import type { AuthorizationPolicy } from '../../domain/value-objects/authorization-policy';
import { isPolicyScope, type PolicyScope } from '../../domain/value-objects/scope-kind';

export interface RegisterPolicyInput {
  readonly code: string;
  readonly roles: readonly RoleCode[];
  /** Required and explicit: there is no default scope kind. */
  readonly scope: PolicyScope;
  readonly ownershipRequiredFor?: readonly RoleCode[];
}

/**
 * Permission registration and lookup. Each module registers ITS OWN permissions here when it is implemented, after the
 * role grants were approved (docs/AUTHORIZATION-MATRIX.md). Module 12 registers none, so everything is denied.
 *
 * The role -> permission grants are stored in Module 09's PermissionRegistry (single source of truth); this registry
 * adds the evaluation policy (scope kind, ownership). A permission registered only in Module 09 has no policy and is
 * therefore denied by the engine.
 */
export class AuthorizationPolicyRegistry {
  private readonly policies = new Map<string, AuthorizationPolicy>();

  constructor(private readonly permissions: PermissionRegistry) {}

  /** Atomic: the policy is stored only after Module 09 accepted the grants. */
  register(input: RegisterPolicyInput): void {
    if (!isPolicyScope(input.scope)) throw authorizationConfigError(`Invalid scope for ${String(input.code)}`);
    const ownershipRequiredFor = input.ownershipRequiredFor ?? [];
    if (new Set(ownershipRequiredFor).size !== ownershipRequiredFor.length) {
      throw authorizationConfigError(`Duplicate ownership roles for ${input.code}`);
    }
    if (!ownershipRequiredFor.every((role) => input.roles.includes(role))) {
      throw authorizationConfigError(`Ownership roles must be granted the permission (${input.code})`);
    }
    if (this.policies.has(input.code)) throw authorizationConfigError(`Policy already registered: ${input.code}`);

    // Validates the code format, the roles (assignable only, non-empty) and duplicates; throws Module 09 errors.
    this.permissions.register({ code: input.code, roles: input.roles });

    this.policies.set(
      input.code,
      Object.freeze({
        code: input.code,
        roles: Object.freeze([...input.roles]),
        scope: input.scope,
        ownershipRequiredFor: Object.freeze([...ownershipRequiredFor]),
      }),
    );
  }

  registerAll(inputs: readonly RegisterPolicyInput[]): void {
    for (const input of inputs) this.register(input);
  }

  get(code: string): AuthorizationPolicy | undefined {
    return this.policies.get(code);
  }

  has(code: string): boolean {
    return this.policies.has(code);
  }

  /** Every registered permission code, sorted. */
  codes(): string[] {
    return [...this.policies.keys()].sort();
  }
}
