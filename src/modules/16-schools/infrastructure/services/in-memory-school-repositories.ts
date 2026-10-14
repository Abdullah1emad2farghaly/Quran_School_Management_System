import type { TransactionContext } from '../../../00-shared-kernel/public';
import type { SchoolCodeSequence } from '../../application/ports/school-code-sequence';
import type { SchoolManagerRepository } from '../../application/ports/school-manager-repository';
import type { SchoolGpsHistoryEntry, SchoolListQuery, SchoolRepository, SchoolStatusHistoryEntry } from '../../application/ports/school-repository';
import { School, type SchoolSnapshot } from '../../domain/entities/school';
import { SchoolManagerAssignment, type SchoolManagerAssignmentSnapshot } from '../../domain/entities/school-manager-assignment';
import { schoolError } from '../../domain/errors/school-errors';
import { formatSchoolCode } from '../../domain/value-objects/school-code';
import { schoolNameKey } from '../../domain/value-objects/school-name';

/** In-memory adapters for unit tests and local wiring. `snapshot()` / `restore()` let a test simulate a rolled-back transaction. */
export class InMemorySchoolRepository implements SchoolRepository {
  readonly rows = new Map<string, SchoolSnapshot>();
  /** Set by tests/wiring so `visibleTo` can include the schools a user actively manages. */
  managedSchoolIds: (userId: string) => readonly string[] = () => [];
  readonly statusHistory: SchoolStatusHistoryEntry[] = [];
  readonly gpsHistory: SchoolGpsHistoryEntry[] = [];

  async insert(school: School, _tx: TransactionContext): Promise<void> {
    this.assertNameFree(school.snapshot, school.holdsName);
    for (const row of this.rows.values()) if (row.code === school.code) throw new Error('Duplicate school code');
    this.rows.set(school.id, school.snapshot);
  }

  async update(school: School, _tx: TransactionContext): Promise<void> {
    const row = this.rows.get(school.id);
    if (!row || row.version !== school.version) throw schoolError('SCHOOL_CONCURRENT_MODIFICATION');
    this.rows.set(school.id, { ...school.snapshot, version: row.version + 1 });
  }

  async findById(id: string, _tx?: TransactionContext): Promise<School | undefined> {
    const row = this.rows.get(id);
    return row ? School.rehydrate(row) : undefined;
  }

  async findByIdForUpdate(id: string, tx: TransactionContext): Promise<School | undefined> {
    return this.findById(id, tx);
  }

  async findByCode(code: string, _tx?: TransactionContext): Promise<School | undefined> {
    for (const row of this.rows.values()) if (row.code === code) return School.rehydrate(row);
    return undefined;
  }

  async list(query: SchoolListQuery, _tx?: TransactionContext): Promise<{ items: School[]; total: number }> {
    const managed = query.visibleTo === undefined ? [] : this.managedSchoolIds(query.visibleTo);
    const key = { createdAt: 'createdAt', code: 'code', name: 'name', status: 'status' }[query.sort] as 'createdAt' | 'code' | 'name' | 'status';
    const rows = [...this.rows.values()]
      .filter((r) => query.visibleTo === undefined || r.createdBy === query.visibleTo || managed.includes(r.id) || (query.organizationIds ?? []).includes(r.organizationId))
      .filter((r) => !query.statuses || query.statuses.length === 0 || query.statuses.includes(r.status))
      .filter((r) => !query.type || r.type === query.type)
      .sort((a, b) => {
        const av = key === 'createdAt' ? a.createdAt.getTime() : a[key];
        const bv = key === 'createdAt' ? b.createdAt.getTime() : b[key];
        const order = av < bv ? -1 : av > bv ? 1 : a.id.localeCompare(b.id);
        return query.direction === 'asc' ? order : -order;
      });
    const start = (query.page.page - 1) * query.page.pageSize;
    return { items: rows.slice(start, start + query.page.pageSize).map((r) => School.rehydrate(r)), total: rows.length };
  }

  async appendStatusHistory(entry: SchoolStatusHistoryEntry, _tx: TransactionContext): Promise<void> {
    this.statusHistory.push(entry);
  }

  async appendGpsHistory(entry: SchoolGpsHistoryEntry, _tx: TransactionContext): Promise<void> {
    this.gpsHistory.push(entry);
  }

  async listStatusHistory(schoolId: string, _tx?: TransactionContext): Promise<SchoolStatusHistoryEntry[]> {
    return this.statusHistory.filter((e) => e.schoolId === schoolId);
  }

  async listGpsHistory(schoolId: string, _tx?: TransactionContext): Promise<SchoolGpsHistoryEntry[]> {
    return this.gpsHistory.filter((e) => e.schoolId === schoolId);
  }

  snapshot(): { rows: [string, SchoolSnapshot][]; status: SchoolStatusHistoryEntry[]; gps: SchoolGpsHistoryEntry[] } {
    return { rows: [...this.rows], status: [...this.statusHistory], gps: [...this.gpsHistory] };
  }

  restore(s: ReturnType<InMemorySchoolRepository['snapshot']>): void {
    this.rows.clear();
    s.rows.forEach(([k, v]) => this.rows.set(k, v));
    this.statusHistory.splice(0, this.statusHistory.length, ...s.status);
    this.gpsHistory.splice(0, this.gpsHistory.length, ...s.gps);
  }

  private assertNameFree(snapshot: SchoolSnapshot, holdsName: boolean): void {
    if (!holdsName) return;
    for (const row of this.rows.values()) {
      if (row.id !== snapshot.id && row.status !== 'REJECTED' && row.organizationId === snapshot.organizationId && schoolNameKey(row.name) === schoolNameKey(snapshot.name)) {
        throw schoolError('SCHOOL_NAME_ALREADY_EXISTS');
      }
    }
  }
}

export class InMemorySchoolManagerRepository implements SchoolManagerRepository {
  readonly rows = new Map<string, SchoolManagerAssignmentSnapshot>();

  async insert(a: SchoolManagerAssignment, _tx: TransactionContext): Promise<void> {
    if (a.isActive && [...this.rows.values()].some((r) => r.schoolId === a.schoolId && r.revokedAt === null)) throw schoolError('SCHOOL_ALREADY_HAS_MANAGER');
    this.rows.set(a.id, a.snapshot);
  }

  async update(a: SchoolManagerAssignment, _tx: TransactionContext): Promise<void> {
    const row = this.rows.get(a.snapshot.id);
    if (!row || row.version !== a.version) throw schoolError('SCHOOL_CONCURRENT_MODIFICATION');
    this.rows.set(a.snapshot.id, { ...a.snapshot, version: row.version + 1 });
  }

  async lockActiveBySchool(schoolId: string, tx: TransactionContext): Promise<SchoolManagerAssignment | undefined> {
    return this.findActiveBySchool(schoolId, tx);
  }

  async findActiveBySchool(schoolId: string, _tx?: TransactionContext): Promise<SchoolManagerAssignment | undefined> {
    const row = [...this.rows.values()].find((r) => r.schoolId === schoolId && r.revokedAt === null);
    return row ? SchoolManagerAssignment.rehydrate(row) : undefined;
  }

  async findHistoryBySchool(schoolId: string, _tx?: TransactionContext): Promise<SchoolManagerAssignment[]> {
    return [...this.rows.values()]
      .filter((r) => r.schoolId === schoolId)
      .sort((a, b) => a.assignedAt.getTime() - b.assignedAt.getTime())
      .map((r) => SchoolManagerAssignment.rehydrate(r));
  }

  async isActiveManager(userId: string, schoolId: string, _tx?: TransactionContext): Promise<boolean> {
    return [...this.rows.values()].some((r) => r.userId === userId && r.schoolId === schoolId && r.revokedAt === null);
  }

  async listActiveSchoolIdsByUser(userId: string, _tx?: TransactionContext): Promise<string[]> {
    return [...this.rows.values()].filter((r) => r.userId === userId && r.revokedAt === null).map((r) => r.schoolId);
  }

  snapshot(): [string, SchoolManagerAssignmentSnapshot][] {
    return [...this.rows];
  }

  restore(s: [string, SchoolManagerAssignmentSnapshot][]): void {
    this.rows.clear();
    s.forEach(([k, v]) => this.rows.set(k, v));
  }
}

export class InMemorySchoolCodeSequence implements SchoolCodeSequence {
  last = 0;

  async allocate(_tx: TransactionContext): Promise<string> {
    this.last += 1;
    return formatSchoolCode(this.last);
  }
}
