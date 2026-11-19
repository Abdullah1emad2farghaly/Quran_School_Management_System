import type { PageRequest, TransactionContext } from '../../../00-shared-kernel/public';
import type { Payment } from '../../domain/entities/payment';
import type { PaymentStatus } from '../../domain/value-objects/payment-vocabulary';

export interface PaymentListQuery {
  readonly schoolId: string;
  readonly month?: string;
  readonly status?: readonly PaymentStatus[];
  readonly studentId?: string;
  readonly subscriptionId?: string;
  /** Newest payment first by default. */
  readonly direction: 'asc' | 'desc';
  readonly page: PageRequest;
}

/**
 * Persistence of Module 34 payments (its own table `payments` only). There is deliberately NO delete operation: a payment is never hard-deleted (§60).
 * Database guard (the final word under concurrency): UNIQUE (subscription_id, active) where `active` is 1 while the payment is SUCCESSFUL and NULL once it is reversed, so a
 * subscription has at most ONE successful payment and any number of reversed ones.
 */
export interface PaymentRepository {
  /** A second SUCCESSFUL payment for the same subscription is PAYMENT_ALREADY_RECORDED (unique index). */
  insert(payment: Payment, tx: TransactionContext): Promise<void>;
  /** Optimistic lock on `version`: PAYMENT_CONCURRENT_MODIFICATION when stale. */
  update(payment: Payment, tx: TransactionContext): Promise<void>;
  findById(id: string, tx?: TransactionContext): Promise<Payment | undefined>;
  /** Locks the row (FOR UPDATE). */
  lockById(id: string, tx: TransactionContext): Promise<Payment | undefined>;
  list(query: PaymentListQuery, tx?: TransactionContext): Promise<{ items: Payment[]; total: number }>;
  /** Read-only aggregate for reports (Module 38): payments per school, billing month and status (SUCCESSFUL / REVERSED; reversed ones stay as history). `fromMonth` / `toMonth` (`YYYY-MM`, inclusive) are optional bounds. */
  countByStatus(query: PaymentStatusCountQuery, tx?: TransactionContext): Promise<PaymentStatusCount[]>;
}

export interface PaymentStatusCountQuery {
  readonly schoolIds: readonly string[];
  readonly fromMonth?: string;
  readonly toMonth?: string;
}

export interface PaymentStatusCount {
  readonly schoolId: string;
  /** `YYYY-MM` (Africa/Cairo). */
  readonly month: string;
  readonly status: PaymentStatus;
  readonly count: number;
}
