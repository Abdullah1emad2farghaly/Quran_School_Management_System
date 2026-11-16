import { pageOffset, type PageRequest, type TransactionContext } from '../../../00-shared-kernel/public';
import type { MemorizationRepository } from '../../application/ports/memorization-repository';
import { MemorizationAssignment, type AssignmentHistoryEntry, type MemorizationAssignmentSnapshot } from '../../domain/entities/memorization-assignment';
import { MemorizationRecord, type MemorizationCorrection, type MemorizationRecordSnapshot } from '../../domain/entities/memorization-record';

/** In-memory MemorizationRepository with the same uniqueness and ordering as the SQL one. For tests of this and other modules. */
export class InMemoryMemorizationRepository implements MemorizationRepository {
  readonly assignments = new Map<string, MemorizationAssignmentSnapshot>();
  readonly assignmentHistory: AssignmentHistoryEntry[] = [];
  readonly records = new Map<string, MemorizationRecordSnapshot & { sessionScheduledStart: Date }>();
  readonly corrections: MemorizationCorrection[] = [];

  async insertAssignment(assignment: MemorizationAssignment, entry: AssignmentHistoryEntry, _tx: TransactionContext): Promise<boolean> {
    const s = assignment.snapshot;
    for (const a of this.assignments.values()) if (a.status === 'ACTIVE' && a.definedInSessionId === s.definedInSessionId && a.studentId === s.studentId) return false;
    this.assignments.set(s.id, { ...s });
    this.assignmentHistory.push({ ...entry });
    return true;
  }
  async lockAssignment(id: string, _tx: TransactionContext) {
    return this.findAssignment(id);
  }
  async lockAssignmentsDefinedInSession(sessionId: string, _tx: TransactionContext) {
    return this.listAssignmentsDefinedInSession(sessionId);
  }
  async applyAssignmentChange(assignment: MemorizationAssignment, entry: AssignmentHistoryEntry, _tx: TransactionContext): Promise<void> {
    const s = assignment.snapshot;
    if (!this.assignments.has(s.id)) throw new Error('memorization assignment not stored');
    this.assignments.set(s.id, { ...s });
    this.assignmentHistory.push({ ...entry });
  }
  async findAssignment(id: string, _tx?: TransactionContext) {
    const row = this.assignments.get(id);
    return row ? MemorizationAssignment.rehydrate({ ...row }) : undefined;
  }
  async listAssignmentsDefinedInSession(sessionId: string, _tx?: TransactionContext) {
    return [...this.assignments.values()].filter((a) => a.definedInSessionId === sessionId).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id)).map((a) => MemorizationAssignment.rehydrate({ ...a }));
  }
  async listActiveAssignmentsOfGroup(groupId: string, _tx?: TransactionContext) {
    return [...this.assignments.values()].filter((a) => a.groupId === groupId && a.status === 'ACTIVE').map((a) => MemorizationAssignment.rehydrate({ ...a }));
  }
  async fulfilledBefore(assignmentIds: readonly string[], before: Date, _tx?: TransactionContext): Promise<Set<string>> {
    const wanted = new Set(assignmentIds);
    const out = new Set<string>();
    for (const r of this.records.values()) if (r.assignmentId !== null && wanted.has(r.assignmentId) && r.matchesAssignment === true && r.sessionScheduledStart.getTime() < before.getTime()) out.add(r.assignmentId);
    return out;
  }

  async insertRecords(records: readonly MemorizationRecord[], sessionScheduledStart: Date, _tx: TransactionContext): Promise<void> {
    for (const r of records) this.records.set(r.snapshot.id, { ...r.snapshot, sessionScheduledStart });
  }
  async lockRecord(id: string, _tx: TransactionContext) {
    return this.findRecord(id);
  }
  async findRecord(id: string, _tx?: TransactionContext) {
    const row = this.records.get(id);
    if (!row) return undefined;
    const { sessionScheduledStart: _ignored, ...snapshot } = row;
    return MemorizationRecord.rehydrate({ ...snapshot });
  }
  async applyRecordCorrection(record: MemorizationRecord, entry: MemorizationCorrection, _tx: TransactionContext): Promise<void> {
    const s = record.snapshot;
    const row = this.records.get(s.id);
    if (!row) throw new Error('memorization record not stored');
    this.records.set(s.id, { ...row, range: s.range, matchesAssignment: s.matchesAssignment, updatedBy: s.updatedBy, updatedAt: s.updatedAt });
    this.corrections.push({ ...entry });
  }
  async listRecordsBySession(sessionId: string, _tx?: TransactionContext) {
    return [...this.records.values()].filter((r) => r.sessionId === sessionId).sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime() || a.id.localeCompare(b.id)).map((r) => this.hydrate(r));
  }
  async listRecordsByStudent(studentId: string, direction: 'asc' | 'desc', page: PageRequest, _tx?: TransactionContext) {
    const all = [...this.records.values()].filter((r) => r.studentId === studentId).sort((a, b) => (direction === 'asc' ? 1 : -1) * (a.sessionScheduledStart.getTime() - b.sessionScheduledStart.getTime()) || a.id.localeCompare(b.id));
    return { items: all.slice(pageOffset(page), pageOffset(page) + page.pageSize).map((r) => this.hydrate(r)), total: all.length };
  }
  async listCorrectionsOfSession(sessionId: string, _tx?: TransactionContext) {
    return this.corrections.filter((c) => c.sessionId === sessionId).map((c) => ({ ...c }));
  }
  async listAssignmentHistoryOfSession(sessionId: string, _tx?: TransactionContext) {
    return this.assignmentHistory.filter((e) => e.sessionId === sessionId).map((e) => ({ ...e }));
  }
  private hydrate(row: MemorizationRecordSnapshot & { sessionScheduledStart: Date }): MemorizationRecord {
    const { sessionScheduledStart: _ignored, ...snapshot } = row;
    return MemorizationRecord.rehydrate({ ...snapshot });
  }
}
