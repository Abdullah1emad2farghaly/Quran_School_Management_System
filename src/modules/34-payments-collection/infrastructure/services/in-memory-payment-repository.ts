import type { TransactionContext } from '../../../00-shared-kernel/public';
import type { PaymentListQuery, PaymentRepository, PaymentStatusCount, PaymentStatusCountQuery } from '../../application/ports/payment-repository';
import { Payment, type PaymentSnapshot } from '../../domain/entities/payment';
import { paymentError } from '../../domain/errors/payment-errors';

/** In-memory PaymentRepository with the same uniqueness (one SUCCESSFUL payment per subscription) and optimistic-lock behavior as the SQL one. For tests of this and other modules. */
export class InMemoryPaymentRepository implements PaymentRepository {
  readonly rows = new Map<string, PaymentSnapshot>();

  async insert(payment: Payment, _tx: TransactionContext): Promise<void> {
    const s = payment.snapshot;
    for (const r of this.rows.values()) if (r.subscriptionId === s.subscriptionId && r.status === 'SUCCESSFUL' && s.status === 'SUCCESSFUL') throw paymentError('PAYMENT_ALREADY_RECORDED');
    this.rows.set(s.id, { ...s, version: 1 });
  }
  async update(payment: Payment, _tx: TransactionContext): Promise<void> {
    const s = payment.snapshot;
    const row = this.rows.get(s.id);
    if (!row || row.version !== s.version) throw paymentError('PAYMENT_CONCURRENT_MODIFICATION');
    this.rows.set(s.id, { ...s, version: s.version + 1 });
  }
  async findById(id: string, _tx?: TransactionContext): Promise<Payment | undefined> {
    const r = this.rows.get(id);
    return r ? Payment.rehydrate({ ...r }) : undefined;
  }
  lockById(id: string, tx: TransactionContext): Promise<Payment | undefined> {
    return this.findById(id, tx);
  }
  async list(query: PaymentListQuery, _tx?: TransactionContext): Promise<{ items: Payment[]; total: number }> {
    const sign = query.direction === 'asc' ? 1 : -1;
    const all = [...this.rows.values()]
      .filter(
        (r) =>
          r.schoolId === query.schoolId &&
          (query.month === undefined || r.month === query.month) &&
          (query.studentId === undefined || r.studentId === query.studentId) &&
          (query.subscriptionId === undefined || r.subscriptionId === query.subscriptionId) &&
          (!query.status || query.status.length === 0 || query.status.includes(r.status)),
      )
      .sort((a, b) => sign * (a.recordedAt.getTime() - b.recordedAt.getTime() || (a.id < b.id ? -1 : 1)));
    const start = (query.page.page - 1) * query.page.pageSize;
    return { items: all.slice(start, start + query.page.pageSize).map((r) => Payment.rehydrate({ ...r })), total: all.length };
  }

  async countByStatus(query: PaymentStatusCountQuery, _tx?: TransactionContext): Promise<PaymentStatusCount[]> {
    const schools = new Set(query.schoolIds);
    const totals = new Map<string, PaymentStatusCount>();
    for (const r of this.rows.values()) {
      if (!schools.has(r.schoolId)) continue;
      if (query.fromMonth !== undefined && r.month < query.fromMonth) continue;
      if (query.toMonth !== undefined && r.month > query.toMonth) continue;
      const key = `${r.schoolId}|${r.month}|${r.status}`;
      totals.set(key, { schoolId: r.schoolId, month: r.month, status: r.status, count: (totals.get(key)?.count ?? 0) + 1 });
    }
    return [...totals.values()].sort((a, b) => (a.schoolId < b.schoolId ? -1 : a.schoolId > b.schoolId ? 1 : a.month < b.month ? -1 : a.month > b.month ? 1 : a.status < b.status ? -1 : a.status > b.status ? 1 : 0));
  }

  snapshot(): Array<[string, PaymentSnapshot]> {
    return [...this.rows];
  }
  restore(saved: Array<[string, PaymentSnapshot]>): void {
    this.rows.clear();
    saved.forEach(([k, v]) => this.rows.set(k, v));
  }
}