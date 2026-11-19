import type { PaymentDto } from '../../application/dto/payment-dto';

const iso = (d: Date): string => d.toISOString();

/** The public JSON of a payment: Student + School + Subscription, CASH, status and the audit facts of the recording and the reversal. No amount exists. */
export const serializePayment = (p: PaymentDto) => ({
  id: p.id,
  subscriptionId: p.subscriptionId,
  studentId: p.studentId,
  schoolId: p.schoolId,
  month: p.month,
  method: p.method,
  status: p.status,
  recordedBy: p.recordedBy,
  recordedAt: iso(p.recordedAt),
  reversedBy: p.reversedBy,
  reversedAt: p.reversedAt ? iso(p.reversedAt) : null,
  reversalReason: p.reversalReason,
  updatedAt: iso(p.updatedAt),
});
