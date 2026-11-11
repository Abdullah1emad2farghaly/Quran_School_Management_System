import type { TransactionContext } from '../../../00-shared-kernel/public';
import type { CollectorLinkRepository } from '../../application/ports/collector-link-repository';
import type { SubscriptionListQuery, SubscriptionRepository } from '../../application/ports/subscription-repository';
import { CollectorSchoolLink, type CollectorSchoolLinkSnapshot } from '../../domain/entities/collector-school-link';
import { Subscription, type SubscriptionSnapshot } from '../../domain/entities/subscription';
import { SubscriptionBatch, type SubscriptionBatchSnapshot } from '../../domain/entities/subscription-batch';
import { subscriptionError } from '../../domain/errors/subscription-errors';

const byMonthThenId = (a: SubscriptionSnapshot, b: SubscriptionSnapshot): number => (a.month < b.month ? -1 : a.month > b.month ? 1 : a.id < b.id ? -1 : 1);

/** In-memory SubscriptionRepository with the same uniqueness (student+month, school+month) and optimistic-lock behavior as the SQL one. For tests of this and other modules. */
export class InMemorySubscriptionRepository implements SubscriptionRepository {
  readonly rows = new Map<string, SubscriptionSnapshot>();
  readonly batchRows = new Map<string, SubscriptionBatchSnapshot>();

  async insertBatch(batch: SubscriptionBatch, _tx: TransactionContext): Promise<void> {
    const s = batch.snapshot;
    for (const b of this.batchRows.values()) if (b.schoolId === s.schoolId && b.month === s.month) throw subscriptionError('SUBSCRIPTIONS_ALREADY_CREATED_FOR_MONTH');
    this.batchRows.set(s.id, { ...s });
  }
  async findBatchBySchoolMonth(schoolId: string, month: string, _tx?: TransactionContext): Promise<SubscriptionBatch | undefined> {
    for (const b of this.batchRows.values()) if (b.schoolId === schoolId && b.month === month) return SubscriptionBatch.rehydrate(b);
    return undefined;
  }
  async findBatchById(batchId: string, _tx?: TransactionContext): Promise<SubscriptionBatch | undefined> {
    const b = this.batchRows.get(batchId);
    return b ? SubscriptionBatch.rehydrate(b) : undefined;
  }

  async insertMany(subscriptions: readonly Subscription[], _tx: TransactionContext): Promise<void> {
    const staged = new Map<string, SubscriptionSnapshot>();
    for (const subscription of subscriptions) {
      const s = subscription.snapshot;
      const clash = [...this.rows.values(), ...staged.values()].some((r) => r.studentId === s.studentId && r.month === s.month);
      if (clash) throw subscriptionError('SUBSCRIPTION_ALREADY_EXISTS');
      staged.set(s.id, { ...s, version: 1 });
    }
    for (const [id, row] of staged) this.rows.set(id, row);
  }
  async insert(subscription: Subscription, tx: TransactionContext): Promise<void> {
    await this.insertMany([subscription], tx);
  }
  async update(subscription: Subscription, _tx: TransactionContext): Promise<void> {
    const s = subscription.snapshot;
    const row = this.rows.get(s.id);
    if (!row || row.version !== s.version) throw subscriptionError('SUBSCRIPTION_CONCURRENT_MODIFICATION');
    this.rows.set(s.id, { ...s, version: s.version + 1 });
  }

  async findById(id: string, _tx?: TransactionContext): Promise<Subscription | undefined> {
    const r = this.rows.get(id);
    return r ? Subscription.rehydrate(r) : undefined;
  }
  lockById(id: string, tx: TransactionContext): Promise<Subscription | undefined> {
    return this.findById(id, tx);
  }
  async lockAllOfStudent(studentId: string, _tx: TransactionContext): Promise<Subscription[]> {
    return [...this.rows.values()].filter((r) => r.studentId === studentId).sort(byMonthThenId).map((r) => Subscription.rehydrate(r));
  }
  async findByStudentMonth(studentId: string, month: string, _tx?: TransactionContext): Promise<Subscription | undefined> {
    for (const r of this.rows.values()) if (r.studentId === studentId && r.month === month) return Subscription.rehydrate(r);
    return undefined;
  }

  async list(query: SubscriptionListQuery, _tx?: TransactionContext): Promise<{ items: Subscription[]; total: number }> {
    const sign = query.direction === 'asc' ? 1 : -1;
    const all = [...this.rows.values()]
      .filter((r) => r.schoolId === query.schoolId && (query.month === undefined || r.month === query.month) && (query.studentId === undefined || r.studentId === query.studentId) && (!query.status || query.status.length === 0 || query.status.includes(r.status)))
      .sort((a, b) => sign * (a.month < b.month ? -1 : a.month > b.month ? 1 : a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : 1)));
    const start = (query.page.page - 1) * query.page.pageSize;
    return { items: all.slice(start, start + query.page.pageSize).map((r) => Subscription.rehydrate(r)), total: all.length };
  }
  async listByStudentsMonth(studentIds: readonly string[], month: string, _tx?: TransactionContext): Promise<Subscription[]> {
    const wanted = new Set(studentIds);
    return [...this.rows.values()].filter((r) => r.month === month && wanted.has(r.studentId)).map((r) => Subscription.rehydrate(r));
  }
  async listByBatch(batchId: string, _tx?: TransactionContext): Promise<Subscription[]> {
    return [...this.rows.values()].filter((r) => r.batchId === batchId).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : 1)).map((r) => Subscription.rehydrate(r));
  }
  async listUnpaidOfSchoolMonth(schoolId: string, month: string, _tx?: TransactionContext): Promise<Subscription[]> {
    return [...this.rows.values()].filter((r) => r.schoolId === schoolId && r.month === month && r.status === 'UNPAID').sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : 1)).map((r) => Subscription.rehydrate(r));
  }

  snapshot(): { rows: Array<[string, SubscriptionSnapshot]>; batches: Array<[string, SubscriptionBatchSnapshot]> } {
    return { rows: [...this.rows], batches: [...this.batchRows] };
  }
  restore(saved: { rows: Array<[string, SubscriptionSnapshot]>; batches: Array<[string, SubscriptionBatchSnapshot]> }): void {
    this.rows.clear();
    this.batchRows.clear();
    saved.rows.forEach(([k, v]) => this.rows.set(k, v));
    saved.batches.forEach(([k, v]) => this.batchRows.set(k, v));
  }
}

const byLinked = (a: CollectorSchoolLinkSnapshot, b: CollectorSchoolLinkSnapshot): number => a.linkedAt.getTime() - b.linkedAt.getTime() || (a.id < b.id ? -1 : 1);

/** In-memory CollectorLinkRepository with the same one-active-link-per-(account, school) behavior as the SQL one. */
export class InMemoryCollectorLinkRepository implements CollectorLinkRepository {
  readonly rows = new Map<string, CollectorSchoolLinkSnapshot>();

  async insert(link: CollectorSchoolLink, _tx: TransactionContext): Promise<void> {
    const s = link.snapshot;
    for (const r of this.rows.values()) if (r.userId === s.userId && r.schoolId === s.schoolId && r.unlinkedAt === null) throw subscriptionError('COLLECTOR_ALREADY_LINKED_TO_SCHOOL');
    this.rows.set(s.id, { ...s, version: 1 });
  }
  async update(link: CollectorSchoolLink, _tx: TransactionContext): Promise<void> {
    const s = link.snapshot;
    const row = this.rows.get(s.id);
    if (!row || row.version !== s.version) throw subscriptionError('COLLECTOR_CONCURRENT_MODIFICATION');
    this.rows.set(s.id, { ...s, version: s.version + 1 });
  }
  async findActive(userId: string, schoolId: string, _tx?: TransactionContext): Promise<CollectorSchoolLink | undefined> {
    for (const r of this.rows.values()) if (r.userId === userId && r.schoolId === schoolId && r.unlinkedAt === null) return CollectorSchoolLink.rehydrate(r);
    return undefined;
  }
  lockActive(userId: string, schoolId: string, tx: TransactionContext): Promise<CollectorSchoolLink | undefined> {
    return this.findActive(userId, schoolId, tx);
  }
  async listActiveByUser(userId: string, _tx?: TransactionContext): Promise<CollectorSchoolLink[]> {
    return [...this.rows.values()].filter((r) => r.userId === userId && r.unlinkedAt === null).sort(byLinked).map((r) => CollectorSchoolLink.rehydrate(r));
  }
  async listActiveBySchool(schoolId: string, _tx?: TransactionContext): Promise<CollectorSchoolLink[]> {
    return [...this.rows.values()].filter((r) => r.schoolId === schoolId && r.unlinkedAt === null).sort(byLinked).map((r) => CollectorSchoolLink.rehydrate(r));
  }
  async listHistoryByUser(userId: string, _tx?: TransactionContext): Promise<CollectorSchoolLink[]> {
    return [...this.rows.values()].filter((r) => r.userId === userId).sort(byLinked).map((r) => CollectorSchoolLink.rehydrate(r));
  }
  async findOrganizationOfUser(userId: string, _tx?: TransactionContext): Promise<string | undefined> {
    for (const r of this.rows.values()) if (r.userId === userId) return r.organizationId;
    return undefined;
  }

  snapshot(): Array<[string, CollectorSchoolLinkSnapshot]> {
    return [...this.rows];
  }
  restore(saved: Array<[string, CollectorSchoolLinkSnapshot]>): void {
    this.rows.clear();
    saved.forEach(([k, v]) => this.rows.set(k, v));
  }
}
