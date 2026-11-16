import type { PageRequest, TransactionContext } from '../../../00-shared-kernel/public';
import type { SubscriptionBatch } from '../../domain/entities/subscription-batch';
import type { Subscription } from '../../domain/entities/subscription';
import type { SubscriptionStatus } from '../../domain/value-objects/subscription-status';

export interface SubscriptionListQuery {
  readonly schoolId: string;
  readonly month?: string;
  readonly status?: readonly SubscriptionStatus[];
  readonly studentId?: string;
  /** Newest month first by default. */
  readonly direction: 'asc' | 'desc';
  readonly page: PageRequest;
}

/**
 * Persistence of Module 33 subscriptions (its own tables `subscriptions` and `subscription_batches` only).
 * Database guards (the final word under concurrency): UNIQUE (student_id, month) on subscriptions and UNIQUE (school_id, month) on batches.
 */
export interface SubscriptionRepository {
  /** Records that the bulk creation of (school, month) was done. A second one is SUBSCRIPTIONS_ALREADY_CREATED_FOR_MONTH (unique index). */
  insertBatch(batch: SubscriptionBatch, tx: TransactionContext): Promise<void>;
  findBatchBySchoolMonth(schoolId: string, month: string, tx?: TransactionContext): Promise<SubscriptionBatch | undefined>;
  findBatchById(batchId: string, tx?: TransactionContext): Promise<SubscriptionBatch | undefined>;

  /** Inserts the subscriptions of one bulk run (in chunks). A (student, month) that exists is SUBSCRIPTION_ALREADY_EXISTS. */
  insertMany(subscriptions: readonly Subscription[], tx: TransactionContext): Promise<void>;
  insert(subscription: Subscription, tx: TransactionContext): Promise<void>;
  /** Optimistic lock on `version`: SUBSCRIPTION_CONCURRENT_MODIFICATION when stale. */
  update(subscription: Subscription, tx: TransactionContext): Promise<void>;

  findById(id: string, tx?: TransactionContext): Promise<Subscription | undefined>;
  /** Locks the row (FOR UPDATE). */
  lockById(id: string, tx: TransactionContext): Promise<Subscription | undefined>;
  /**
   * Locks EVERY subscription of the student (all months, one statement, oldest month first) and returns them. This is what makes the Oldest-Unpaid Rule safe: two payments
   * (or a payment and a waiver) of the same student are serialized, so neither can read the other's months half-way.
   */
  lockAllOfStudent(studentId: string, tx: TransactionContext): Promise<Subscription[]>;
  findByStudentMonth(studentId: string, month: string, tx?: TransactionContext): Promise<Subscription | undefined>;

  list(query: SubscriptionListQuery, tx?: TransactionContext): Promise<{ items: Subscription[]; total: number }>;
  /** The subscriptions of the given students for ONE month (students without a record simply have no row; nothing is inferred). Any number of ids. */
  listByStudentsMonth(studentIds: readonly string[], month: string, tx?: TransactionContext): Promise<Subscription[]>;
  listByBatch(batchId: string, tx?: TransactionContext): Promise<Subscription[]>;
  listUnpaidOfSchoolMonth(schoolId: string, month: string, tx?: TransactionContext): Promise<Subscription[]>;
}
