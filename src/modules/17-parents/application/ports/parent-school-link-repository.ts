import type { TransactionContext } from '../../../00-shared-kernel/public';
import type { ParentSchoolLink } from '../../domain/entities/parent-school-link';

export interface ParentSchoolLinkRepository {
  /** Inserts an ACTIVE link. The unique (parent, school, active) index is the final guard: PARENT_ALREADY_LINKED_TO_SCHOOL. */
  insert(link: ParentSchoolLink, tx: TransactionContext): Promise<void>;
  /** Persists the removal (history is kept). Optimistic lock on the version. */
  update(link: ParentSchoolLink, tx: TransactionContext): Promise<void>;
  findActive(parentId: string, schoolId: string, tx?: TransactionContext): Promise<ParentSchoolLink | undefined>;
  lockActive(parentId: string, schoolId: string, tx: TransactionContext): Promise<ParentSchoolLink | undefined>;
  listActiveByParent(parentId: string, tx?: TransactionContext): Promise<ParentSchoolLink[]>;
  listActiveByParents(parentIds: readonly string[], tx?: TransactionContext): Promise<Map<string, ParentSchoolLink[]>>;
  /** Every link ever made for the parent (active and removed), oldest first. */
  listHistoryByParent(parentId: string, tx?: TransactionContext): Promise<ParentSchoolLink[]>;
}
