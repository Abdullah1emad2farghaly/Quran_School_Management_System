import type { TransactionContext } from '../../../00-shared-kernel/public';
import type { Organization } from '../../domain/entities/organization';

export interface OrganizationRepository {
  /** Throws ORGANIZATION_ALREADY_EXISTS when the V1 single-organization guard or the unique code rejects the row. */
  insert(organization: Organization, tx: TransactionContext): Promise<void>;
  /** V1: the only organization. */
  findMain(tx?: TransactionContext): Promise<Organization | undefined>;
  findById(id: string, tx?: TransactionContext): Promise<Organization | undefined>;
  /** Next free code sequence (1 for the first organization). */
  nextCodeSequence(tx?: TransactionContext): Promise<number>;
}
