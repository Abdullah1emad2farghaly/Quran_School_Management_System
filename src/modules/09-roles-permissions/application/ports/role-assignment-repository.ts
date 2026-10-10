import type { TransactionContext } from '../../../00-shared-kernel/public';
import type { RoleAssignment } from '../../domain/entities/role-assignment';
import type { RoleCode } from '../../domain/value-objects/role-code';

export interface RoleAssignmentRepository {
  /** Throws ROLE_ALREADY_ASSIGNED when the user already has this role ACTIVE (unique index guard). */
  insert(assignment: RoleAssignment, tx: TransactionContext): Promise<void>;
  /** Optimistic lock on `assignment.version`. Throws ROLE_CONCURRENT_MODIFICATION when stale. */
  update(assignment: RoleAssignment, tx: TransactionContext): Promise<void>;
  /** All of the user's assignments (history included), locked for the rest of the transaction. */
  lockAllByUser(userId: string, tx: TransactionContext): Promise<RoleAssignment[]>;
  findActiveByUser(userId: string, tx?: TransactionContext): Promise<RoleAssignment[]>;
  /** How many ACTIVE assignments of this role exist across all users (used, for example, by the first-Main-Admin bootstrap). */
  countActiveByRole(roleCode: RoleCode, tx?: TransactionContext): Promise<number>;
  /** Oldest first. */
  findHistoryByUser(userId: string, tx?: TransactionContext): Promise<RoleAssignment[]>;
}
