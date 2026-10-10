import { SystemClock, type Clock, type TransactionContext, type UnitOfWork } from '../../../00-shared-kernel/public';
import type { OutboxService } from '../../../06-domain-events-outbox/public';
import { identityError, type IdentityService } from '../../../08-identity-core/public';
import { RoleAssignment } from '../../domain/entities/role-assignment';
import { roleError } from '../../domain/errors/role-errors';
import type { PermissionRegistry } from '../../domain/services/permission-registry';
import { isAssignableRole, isRoleCode, sortRoles, type RoleCode } from '../../domain/value-objects/role-code';
import { toRoleAssignmentDto, type RoleAssignmentDto } from '../dto/role-assignment-dto';
import type { RoleAssignmentRepository } from '../ports/role-assignment-repository';

export interface AssignRoleInput {
  readonly userId: string;
  readonly roleCode: string;
  /** The authenticated actor. `null` = the system (for example the first Main Admin from a setup script). */
  readonly assignedBy: string | null;
}

export interface RevokeRoleInput {
  readonly userId: string;
  readonly roleCode: string;
  readonly revokedBy: string | null;
}

export interface RoleServiceDeps {
  readonly repository: RoleAssignmentRepository;
  readonly identity: Pick<IdentityService, 'findById'>;
  readonly permissions: PermissionRegistry;
  readonly unitOfWork: UnitOfWork;
  readonly outbox: OutboxService;
  readonly clock?: Clock;
}

/**
 * Public application contract of Module 09 (Roles & Permissions): role assignments with full
 * history, plus the role -> permission check.
 *
 * It does NOT authorize its callers. WHO may assign or revoke roles (and for which scope) is decided by
 * the calling module and the authorization engine (Module 12) before they call it. It also does not
 * decide which role combinations a given person may hold ("if identity/business rules allow it", §19):
 * the owning module (Parents, Teachers, Schools...) enforces that.
 *
 * Every write accepts an optional transaction so a caller can make its changes atomic with the
 * role change (for example creating a Parent and assigning the Parent role together).
 */
export class RoleService {
  private readonly repository: RoleAssignmentRepository;
  private readonly identity: Pick<IdentityService, 'findById'>;
  private readonly permissions: PermissionRegistry;
  private readonly unitOfWork: UnitOfWork;
  private readonly outbox: OutboxService;
  private readonly clock: Clock;

  constructor(deps: RoleServiceDeps) {
    this.repository = deps.repository;
    this.identity = deps.identity;
    this.permissions = deps.permissions;
    this.unitOfWork = deps.unitOfWork;
    this.outbox = deps.outbox;
    this.clock = deps.clock ?? new SystemClock();
  }

  /**
   * Gives the user a role. Fails with ROLE_ALREADY_ASSIGNED when it is already active (never duplicated),
   * ROLE_NOT_ASSIGNABLE for Student, USER_NOT_FOUND for an unknown user or actor.
   */
  async assignRole(input: AssignRoleInput, tx?: TransactionContext): Promise<RoleAssignmentDto> {
    if (!isRoleCode(input.roleCode)) throw roleError('INVALID_ROLE');
    if (!isAssignableRole(input.roleCode)) throw roleError('ROLE_NOT_ASSIGNABLE');
    const roleCode: RoleCode = input.roleCode;

    return this.inTransaction(tx, async (t) => {
      await this.requireUser(input.userId, t);
      if (input.assignedBy !== null) await this.requireUser(input.assignedBy, t);

      const active = await this.repository.findActiveByUser(input.userId, t);
      if (active.some((a) => a.roleCode === roleCode)) throw roleError('ROLE_ALREADY_ASSIGNED');

      const assignment = RoleAssignment.assign({
        userId: input.userId,
        roleCode,
        assignedBy: input.assignedBy,
        clock: this.clock,
      });
      await this.repository.insert(assignment, t);
      await this.outbox.publishFrom(assignment, t);
      return toRoleAssignmentDto(assignment);
    });
  }

  /**
   * Ends an active role (history is kept). A user must always keep at least one active role (§19):
   * revoking the last one fails with LAST_ACTIVE_ROLE. To CHANGE a role, assign the new role first and
   * then revoke the old one, in the same transaction.
   */
  async revokeRole(input: RevokeRoleInput, tx?: TransactionContext): Promise<RoleAssignmentDto> {
    if (!isRoleCode(input.roleCode)) throw roleError('INVALID_ROLE');
    const roleCode: RoleCode = input.roleCode;

    return this.inTransaction(tx, async (t) => {
      if (input.revokedBy !== null) await this.requireUser(input.revokedBy, t);

      // Locks every assignment row of this user, so two concurrent revocations cannot both pass the check.
      const all = await this.repository.lockAllByUser(input.userId, t);
      const active = all.filter((a) => a.isActive);
      const target = active.find((a) => a.roleCode === roleCode);
      if (!target) throw roleError('ROLE_ASSIGNMENT_NOT_FOUND');
      if (active.length <= 1) throw roleError('LAST_ACTIVE_ROLE');

      target.revoke(input.revokedBy, this.clock);
      await this.repository.update(target, t);
      await this.outbox.publishFrom(target, t);
      return toRoleAssignmentDto(target);
    });
  }

  /** The user's active roles in catalog order. Empty for unknown users. */
  async listActiveRoles(userId: string, tx?: TransactionContext): Promise<RoleCode[]> {
    const active = await this.repository.findActiveByUser(userId, tx);
    return sortRoles(active.map((a) => a.roleCode));
  }

  /** Full history, oldest first (active and revoked). */
  async listRoleHistory(userId: string, tx?: TransactionContext): Promise<RoleAssignmentDto[]> {
    return (await this.repository.findHistoryByUser(userId, tx)).map(toRoleAssignmentDto);
  }

  async hasRole(userId: string, role: RoleCode, tx?: TransactionContext): Promise<boolean> {
    return (await this.listActiveRoles(userId, tx)).includes(role);
  }

  async hasAnyRole(userId: string, roles: readonly RoleCode[], tx?: TransactionContext): Promise<boolean> {
    const active = await this.listActiveRoles(userId, tx);
    return roles.some((role) => active.includes(role));
  }

  /**
   * RBAC check: does any ACTIVE role of the user grant this permission? Deny by default (unknown
   * permission, unknown user, or no roles all give false). This is only the first authorization
   * step; scope, ownership, business rules and smart guards still apply (Module 12).
   */
  async hasPermission(userId: string, permissionCode: string, tx?: TransactionContext): Promise<boolean> {
    if (!this.permissions.isRegistered(permissionCode)) return false;
    return this.permissions.anyRoleHasPermission(await this.listActiveRoles(userId, tx), permissionCode);
  }

  /** Every registered permission granted through the user's active roles, sorted. */
  async listPermissions(userId: string, tx?: TransactionContext): Promise<string[]> {
    return this.permissions.permissionsOfRoles(await this.listActiveRoles(userId, tx));
  }

  private async requireUser(userId: string, tx: TransactionContext): Promise<void> {
    // USER_NOT_FOUND is the identity module's contract for unknown users.
    if (!(await this.identity.findById(userId, tx))) throw identityError('USER_NOT_FOUND');
  }

  private inTransaction<T>(tx: TransactionContext | undefined, work: (tx: TransactionContext) => Promise<T>): Promise<T> {
    return tx ? work(tx) : this.unitOfWork.run(work);
  }
}
