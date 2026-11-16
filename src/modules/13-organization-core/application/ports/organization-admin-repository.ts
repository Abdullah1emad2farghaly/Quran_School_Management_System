import type { TransactionContext } from '../../../00-shared-kernel/public';
import type { OrganizationAdminAssignment } from '../../domain/entities/organization-admin-assignment';

export interface OrganizationAdminRepository {
  /** Inserts a new active link (the unique index on organization + user + active is the final guard). */
  insert(assignment: OrganizationAdminAssignment, tx: TransactionContext): Promise<void>;
  findActive(userId: string, organizationId: string, tx?: TransactionContext): Promise<OrganizationAdminAssignment | undefined>;
  listActiveOrganizationIdsByUser(userId: string, tx?: TransactionContext): Promise<string[]>;
  /** The user ids of the ACTIVE administrators of an organization (Module 32 notifies them of a school request). Oldest link first. */
  listActiveUserIdsByOrganization(organizationId: string, tx?: TransactionContext): Promise<string[]>;
}
