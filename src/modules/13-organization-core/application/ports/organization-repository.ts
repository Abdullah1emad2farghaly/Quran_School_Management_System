import type { TransactionContext } from '../../../00-shared-kernel/public';
import type { Organization } from '../../domain/entities/organization';

export interface OrganizationRepository {
  /** Throws ORGANIZATION_ALREADY_EXISTS when the V1 single-organization guard or the unique code rejects the row. */
  insert(organization: Organization, tx: TransactionContext): Promise<void>;
  /** V1: the only organization. */
  findMain(tx?: TransactionContext): Promise<Organization | undefined>;
  /** Same as `findMain`, but locks the row for the rest of the transaction (`FOR UPDATE`). */
  findMainForUpdate(tx: TransactionContext): Promise<Organization | undefined>;
  findById(id: string, tx?: TransactionContext): Promise<Organization | undefined>;
  /**
   * Atomic, set-once country assignment: `UPDATE ... SET country_id = :countryId WHERE id = :id AND country_id IS NULL`.
   * Returns false when no row was changed (the country was already set). Throws ORGANIZATION_COUNTRY_INVALID when
   * the country does not exist (foreign key). This is the ONLY update path of `organizations`.
   */
  assignCountryIfUnset(organizationId: string, countryId: string, updatedAt: Date, tx: TransactionContext): Promise<boolean>;
  /** Next free code sequence (1 for the first organization). */
  nextCodeSequence(tx?: TransactionContext): Promise<number>;
}
