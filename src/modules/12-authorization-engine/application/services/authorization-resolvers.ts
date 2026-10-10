import { authorizationConfigError } from '../../domain/errors/authorization-errors';
import { isEntityType } from '../../domain/value-objects/entity-ref';
import { isScopeKind, type ScopeKind } from '../../domain/value-objects/scope-kind';
import type { OwnershipResolver } from '../ports/ownership-resolver';
import type { ScopeResolver } from '../ports/scope-resolver';

/**
 * Where owning modules plug in. A scope resolver is registered per (scope kind, target type): the Schools module
 * registers `MANAGEMENT`/`SCHOOL`, Geography registers `MANAGEMENT`/`GOVERNORATE`, and so on. Reporting resolvers are
 * registered separately, so management data can never answer a reporting question or vice versa.
 *
 * No resolver registered means "cannot prove it", which the engine treats as a denial.
 */
export class AuthorizationResolvers {
  private readonly scope = new Map<string, ScopeResolver>();
  private readonly ownership = new Map<string, OwnershipResolver>();

  registerScopeResolver(kind: ScopeKind, targetType: string, resolver: ScopeResolver): void {
    if (!isScopeKind(kind) || !isEntityType(targetType)) throw authorizationConfigError('Invalid scope resolver registration');
    const key = `${kind}:${targetType}`;
    if (this.scope.has(key)) throw authorizationConfigError(`Scope resolver already registered: ${key}`);
    this.scope.set(key, resolver);
  }

  registerOwnershipResolver(resourceType: string, resolver: OwnershipResolver): void {
    if (!isEntityType(resourceType)) throw authorizationConfigError('Invalid ownership resolver registration');
    if (this.ownership.has(resourceType)) throw authorizationConfigError(`Ownership resolver already registered: ${resourceType}`);
    this.ownership.set(resourceType, resolver);
  }

  scopeResolverFor(kind: ScopeKind, targetType: string): ScopeResolver | undefined {
    return this.scope.get(`${kind}:${targetType}`);
  }

  ownershipResolverFor(resourceType: string): OwnershipResolver | undefined {
    return this.ownership.get(resourceType);
  }
}
