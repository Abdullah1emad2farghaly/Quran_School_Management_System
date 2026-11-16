import type { PageRequest, TransactionContext } from '../../../00-shared-kernel/public';
import { pageOffset } from '../../../00-shared-kernel/public';
import type { ClassSessionRepository, SessionListFilter } from '../../application/ports/session-repository';
import { ClassSession, type ClassSessionSnapshot } from '../../domain/entities/class-session';

/** In-memory ClassSessionRepository with the same uniqueness and ordering as the SQL one. For tests of this and other modules. */
export class InMemoryClassSessionRepository implements ClassSessionRepository {
  readonly rows = new Map<string, ClassSessionSnapshot>();

  async insertIfAbsent(session: ClassSession, _tx: TransactionContext): Promise<boolean> {
    const s = session.snapshot;
    for (const row of this.rows.values()) if (row.slotId === s.slotId && row.occurrenceDate === s.occurrenceDate) return false;
    this.rows.set(s.id, { ...s });
    return true;
  }

  async save(session: ClassSession, _tx: TransactionContext): Promise<void> {
    const s = session.snapshot;
    const row = this.rows.get(s.id);
    if (!row) throw new Error('session not stored');
    // Only the changing columns are written; identity, slot, group, Teacher and times never change.
    this.rows.set(s.id, { ...row, status: s.status, startedAt: s.startedAt, completedAt: s.completedAt, cancelledAt: s.cancelledAt, cancelledBy: s.cancelledBy, cancelSource: s.cancelSource, cancelReason: s.cancelReason, slotRetireReason: s.slotRetireReason });
  }

  async lockById(id: string, _tx: TransactionContext): Promise<ClassSession | undefined> {
    return this.findById(id);
  }

  async findById(id: string, _tx?: TransactionContext): Promise<ClassSession | undefined> {
    const row = this.rows.get(id);
    return row ? ClassSession.rehydrate({ ...row }) : undefined;
  }

  async lockOpenBySlot(slotId: string, _tx: TransactionContext): Promise<ClassSession[]> {
    return [...this.rows.values()].filter((r) => r.slotId === slotId && r.status === 'OPEN').map((r) => ClassSession.rehydrate({ ...r }));
  }

  async listDueIds(now: Date, limit: number, _tx?: TransactionContext): Promise<string[]> {
    return [...this.rows.values()]
      .filter((r) => (r.status === 'OPEN' && r.scheduledStart <= now) || (r.status === 'IN_PROGRESS' && r.scheduledEnd <= now))
      .sort((a, b) => a.scheduledStart.getTime() - b.scheduledStart.getTime())
      .slice(0, limit)
      .map((r) => r.id);
  }

  async listOpenSlotIds(_tx?: TransactionContext): Promise<string[]> {
    return [...new Set([...this.rows.values()].filter((r) => r.status === 'OPEN').map((r) => r.slotId))];
  }

  async listByGroup(groupId: string, filter: SessionListFilter, page: PageRequest, _tx?: TransactionContext) {
    return this.list((r) => r.groupId === groupId, filter, page);
  }

  async listByTeacher(teacherId: string, filter: SessionListFilter, page: PageRequest, _tx?: TransactionContext) {
    return this.list((r) => r.teacherId === teacherId, filter, page);
  }

  private list(match: (r: ClassSessionSnapshot) => boolean, filter: SessionListFilter, page: PageRequest) {
    const all = [...this.rows.values()]
      .filter((r) => match(r) && (!filter.status || filter.status.includes(r.status)))
      .sort((a, b) => (filter.direction === 'asc' ? 1 : -1) * (a.scheduledStart.getTime() - b.scheduledStart.getTime()) || a.id.localeCompare(b.id));
    return { items: all.slice(pageOffset(page), pageOffset(page) + page.pageSize).map((r) => ClassSession.rehydrate({ ...r })), total: all.length };
  }

  snapshot(): Array<[string, ClassSessionSnapshot]> {
    return [...this.rows];
  }
  restore(saved: Array<[string, ClassSessionSnapshot]>): void {
    this.rows.clear();
    saved.forEach(([k, v]) => this.rows.set(k, v));
  }
}
