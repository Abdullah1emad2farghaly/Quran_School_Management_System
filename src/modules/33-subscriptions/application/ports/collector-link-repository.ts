import type { TransactionContext } from '../../../00-shared-kernel/public';
import type { CollectorSchoolLink } from '../../domain/entities/collector-school-link';

/** Persistence of `collector_school_links`: the Subscription Collector-to-School relationship with history (never deleted). */
export interface CollectorLinkRepository {
  /** Inserts an ACTIVE link. The unique (user, school, active) index is the final guard: COLLECTOR_ALREADY_LINKED_TO_SCHOOL. */
  insert(link: CollectorSchoolLink, tx: TransactionContext): Promise<void>;
  /** Persists the removal (history is kept). Optimistic lock on the version. */
  update(link: CollectorSchoolLink, tx: TransactionContext): Promise<void>;
  findActive(userId: string, schoolId: string, tx?: TransactionContext): Promise<CollectorSchoolLink | undefined>;
  lockActive(userId: string, schoolId: string, tx: TransactionContext): Promise<CollectorSchoolLink | undefined>;
  listActiveByUser(userId: string, tx?: TransactionContext): Promise<CollectorSchoolLink[]>;
  listActiveBySchool(schoolId: string, tx?: TransactionContext): Promise<CollectorSchoolLink[]>;
  /** Every link ever made for the account (active and removed), oldest first. */
  listHistoryByUser(userId: string, tx?: TransactionContext): Promise<CollectorSchoolLink[]>;
  /** The organization of ANY link (active or ended) of the account, or undefined when it never had one. An account never spans organizations through this role. */
  findOrganizationOfUser(userId: string, tx?: TransactionContext): Promise<string | undefined>;
}
