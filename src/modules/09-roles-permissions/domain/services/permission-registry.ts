import { roleError } from '../errors/role-errors';
import { assertPermissionCode } from '../value-objects/permission-code';
import { isAssignableRole, sortRoles, type RoleCode } from '../value-objects/role-code';

export interface PermissionDefinition {
  /** `<module>.<resource>.<action>`, for example `schools.school.create`. */
  readonly code: string;
  /** Roles that are granted this permission (RBAC only; there are no per-user permissions, §19). */
  readonly roles: readonly RoleCode[];
}

/**
 * Role -> permission grants (the "Roles -> Permissions" step of §20).
 *
 * - Each module registers ITS OWN permissions when it is implemented, and the role grants for
 *   them are approved business decisions (the specification never lets a permission be invented).
 *   V1 starts with an EMPTY catalog.
 * - Deny by default: an unregistered permission is never granted to anyone.
 * - Only assignable roles can be granted permissions (Student has no login).
 * - Grants are fixed in code at startup; they cannot be changed at runtime or per user.
 * - A permission is only the FIRST check. Scope, ownership, business rules and smart guards
 *   still apply (Module 12), and reporting scope never implies management permission.
 */
export class PermissionRegistry {
  private readonly grants = new Map<string, ReadonlySet<RoleCode>>();

  register(definition: PermissionDefinition): void {
    assertPermissionCode(definition.code);
    if (this.grants.has(definition.code)) throw roleError('PERMISSION_ALREADY_REGISTERED');
    if (definition.roles.length === 0 || !definition.roles.every(isAssignableRole)) {
      throw roleError('INVALID_PERMISSION_GRANT');
    }
    this.grants.set(definition.code, new Set(definition.roles));
  }

  registerAll(definitions: readonly PermissionDefinition[]): void {
    for (const definition of definitions) this.register(definition);
  }

  isRegistered(code: string): boolean {
    return this.grants.has(code);
  }

  /** Roles granted `code`, in catalog order. Empty for unknown permissions. */
  rolesGranting(code: string): RoleCode[] {
    return sortRoles(this.grants.get(code) ?? []);
  }

  roleHasPermission(role: RoleCode, code: string): boolean {
    return this.grants.get(code)?.has(role) ?? false;
  }

  anyRoleHasPermission(roles: readonly RoleCode[], code: string): boolean {
    const granted = this.grants.get(code);
    return granted !== undefined && roles.some((role) => granted.has(role));
  }

  /** Every registered permission granted to at least one of `roles`, sorted. */
  permissionsOfRoles(roles: readonly RoleCode[]): string[] {
    const result: string[] = [];
    for (const [code, granted] of this.grants) if (roles.some((role) => granted.has(role))) result.push(code);
    return result.sort();
  }

  /** All registered permission codes, sorted. */
  all(): string[] {
    return [...this.grants.keys()].sort();
  }
}
