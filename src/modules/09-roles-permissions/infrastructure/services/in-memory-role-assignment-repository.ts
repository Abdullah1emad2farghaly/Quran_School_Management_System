import type { TransactionContext } from '../../../00-shared-kernel/public';
import type { RoleAssignmentRepository } from '../../application/ports/role-assignment-repository';
import { RoleAssignment, type RoleAssignmentSnapshot } from '../../domain/entities/role-assignment';
import { roleError } from '../../domain/errors/role-errors';
import type { RoleCode } from '../../domain/value-objects/role-code';

/** In-memory RoleAssignmentRepository with the same uniqueness and optimistic-lock behavior. For tests of other modules. */
export class InMemoryRoleAssignmentRepository implements RoleAssignmentRepository {
  readonly rows = new Map<string, RoleAssignmentSnapshot>();

  async insert(a: RoleAssignment, _tx: TransactionContext): Promise<void> {
    for (const row of this.rows.values()) {
      if (row.userId === a.userId && row.roleCode === a.roleCode && row.revokedAt === null) {
        throw roleError('ROLE_ALREADY_ASSIGNED');
      }
    }
    this.rows.set(a.id, this.snapshotOf(a, 1));
  }

  async update(a: RoleAssignment, _tx: TransactionContext): Promise<void> {
    const row = this.rows.get(a.id);
    if (!row || row.version !== a.version) throw roleError('ROLE_CONCURRENT_MODIFICATION');
    this.rows.set(a.id, this.snapshotOf(a, a.version + 1));
  }

  async lockAllByUser(userId: string, _tx: TransactionContext): Promise<RoleAssignment[]> {
    return this.history(userId);
  }

  async findActiveByUser(userId: string, _tx?: TransactionContext): Promise<RoleAssignment[]> {
    return this.history(userId).filter((a) => a.isActive);
  }

  async countActiveByRole(roleCode: RoleCode, _tx?: TransactionContext): Promise<number> {
    return [...this.rows.values()].filter((r) => r.roleCode === roleCode && r.revokedAt === null).length;
  }

  async findHistoryByUser(userId: string, _tx?: TransactionContext): Promise<RoleAssignment[]> {
    return this.history(userId);
  }

  private history(userId: string): RoleAssignment[] {
    return [...this.rows.values()]
      .filter((r) => r.userId === userId)
      .sort((x, y) => x.assignedAt.getTime() - y.assignedAt.getTime() || x.id.localeCompare(y.id))
      .map((r) => RoleAssignment.rehydrate(r));
  }

  private snapshotOf(a: RoleAssignment, version: number): RoleAssignmentSnapshot {
    return {
      id: a.id,
      userId: a.userId,
      roleCode: a.roleCode,
      assignedAt: a.assignedAt,
      assignedBy: a.assignedBy,
      revokedAt: a.revokedAt,
      revokedBy: a.revokedBy,
      version,
    };
  }
}
