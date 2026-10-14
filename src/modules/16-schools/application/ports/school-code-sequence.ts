import type { TransactionContext } from '../../../00-shared-kernel/public';

/**
 * Gap-free school code allocation. The implementation locks the single sequence row for the rest of the
 * caller's transaction, so concurrent creations are serialized and a rolled-back creation leaves no gap.
 */
export interface SchoolCodeSequence {
  /** Returns the next code (`SC-000001`, ...). Must run inside the same transaction that inserts the school. */
  allocate(tx: TransactionContext): Promise<string>;
}
