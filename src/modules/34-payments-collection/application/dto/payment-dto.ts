import type { Payment } from '../../domain/entities/payment';
import type { PaymentMethod, PaymentStatus } from '../../domain/value-objects/payment-vocabulary';

export interface PaymentDto {
  readonly id: string;
  readonly subscriptionId: string;
  readonly studentId: string;
  readonly schoolId: string;
  readonly organizationId: string;
  /** `YYYY-MM` (Africa/Cairo) of the paid subscription. */
  readonly month: string;
  readonly method: PaymentMethod;
  readonly status: PaymentStatus;
  readonly recordedBy: string;
  readonly recordedAt: Date;
  readonly reversedBy: string | null;
  readonly reversedAt: Date | null;
  readonly reversalReason: string | null;
  readonly updatedAt: Date;
}

export interface PaymentScopeDto {
  readonly id: string;
  readonly schoolId: string;
  readonly organizationId: string;
}

export function toPaymentDto(payment: Payment): PaymentDto {
  const s = payment.snapshot;
  return {
    id: s.id,
    subscriptionId: s.subscriptionId,
    studentId: s.studentId,
    schoolId: s.schoolId,
    organizationId: s.organizationId,
    month: s.month,
    method: s.method,
    status: s.status,
    recordedBy: s.recordedBy,
    recordedAt: s.recordedAt,
    reversedBy: s.reversedBy,
    reversedAt: s.reversedAt,
    reversalReason: s.reversalReason,
    updatedAt: s.updatedAt,
  };
}
