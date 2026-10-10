import type { RoleCode } from '../../../09-roles-permissions/public';
import type { ScopeTarget } from '../../domain/value-objects/entity-ref';
import type { ScopeKind } from '../../domain/value-objects/scope-kind';

export interface ScopeQuery {
  readonly userId: string;
  /** The active role through which the permission is being exercised. Scope held under another role does not count. */
  readonly role: RoleCode;
  readonly kind: ScopeKind;
  readonly target: ScopeTarget;
}

/**
 * Implemented by the module that OWNS the scope data (organization, geography, schools, teachers, parents...). Module 12
 * does not own or invent assignment tables or organizational hierarchies: it asks.
 *
 * Contract:
 * - Return `true` ONLY when the user's `kind` scope under `role` positively covers `target` (including whatever
 *   descendant rule the owning module has had approved). Anything else, including "I do not know", is `false`.
 * - Resolve the target's own position from server-side data. Never trust a school/scope id supplied by the client.
 * - A resolver for MANAGEMENT scope must not consult reporting data, and the other way round.
 * - Throwing is allowed: the engine treats it as a denial (fail closed) and logs the error name.
 */
export interface ScopeResolver {
  covers(query: ScopeQuery): Promise<boolean>;
}
