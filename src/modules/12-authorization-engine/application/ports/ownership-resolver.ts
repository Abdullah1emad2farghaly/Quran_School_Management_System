import type { RoleCode } from '../../../09-roles-permissions/public';
import type { ResourceRef } from '../../domain/value-objects/entity-ref';

export interface OwnershipQuery {
  readonly userId: string;
  readonly role: RoleCode;
  readonly resource: ResourceRef;
}

/**
 * Implemented by the module that owns the resource (for example Sessions: "is this the session's teacher?",
 * Parents: "is this the parent's child?"). Same contract as ScopeResolver: `true` only on positive proof, anything
 * else (or an exception) is a denial.
 */
export interface OwnershipResolver {
  isOwner(query: OwnershipQuery): Promise<boolean>;
}
