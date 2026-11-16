import type { PageRequest, TransactionContext } from '../../../00-shared-kernel/public';
import type { AssignmentHistoryEntry, MemorizationAssignment } from '../../domain/entities/memorization-assignment';
import type { MemorizationCorrection, MemorizationRecord } from '../../domain/entities/memorization-record';

/** Persistence of memorization (Module 27's own tables only). Nothing is ever deleted; both history tables are append-only (INSERT only). */
export interface MemorizationRepository {
  /** Inserts the assignment and its DEFINED history entry. Returns false when the subject already has an ACTIVE assignment defined in the same session (unique index). */
  insertAssignment(assignment: MemorizationAssignment, entry: AssignmentHistoryEntry, tx: TransactionContext): Promise<boolean>;
  /** FOR UPDATE. */
  lockAssignment(id: string, tx: TransactionContext): Promise<MemorizationAssignment | undefined>;
  /** FOR UPDATE: every assignment defined in the session (all statuses); also serialises recording against defining. */
  lockAssignmentsDefinedInSession(sessionId: string, tx: TransactionContext): Promise<MemorizationAssignment[]>;
  /** Writes the new range/status of an assignment AND appends its history entry, together. */
  applyAssignmentChange(assignment: MemorizationAssignment, entry: AssignmentHistoryEntry, tx: TransactionContext): Promise<void>;
  findAssignment(id: string, tx?: TransactionContext): Promise<MemorizationAssignment | undefined>;
  listAssignmentsDefinedInSession(sessionId: string, tx?: TransactionContext): Promise<MemorizationAssignment[]>;
  /** ACTIVE assignments of a group (any defining session). */
  listActiveAssignmentsOfGroup(groupId: string, tx?: TransactionContext): Promise<MemorizationAssignment[]>;
  /** Of these assignments, the ones that have a fulfilling record (matches = true) in a session that STARTED BEFORE `before`. */
  fulfilledBefore(assignmentIds: readonly string[], before: Date, tx?: TransactionContext): Promise<Set<string>>;

  insertRecords(records: readonly MemorizationRecord[], sessionScheduledStart: Date, tx: TransactionContext): Promise<void>;
  /** FOR UPDATE. */
  lockRecord(id: string, tx: TransactionContext): Promise<MemorizationRecord | undefined>;
  findRecord(id: string, tx?: TransactionContext): Promise<MemorizationRecord | undefined>;
  /** Writes the corrected range of a record AND appends the correction entry (original value kept), together. */
  applyRecordCorrection(record: MemorizationRecord, entry: MemorizationCorrection, tx: TransactionContext): Promise<void>;
  listRecordsBySession(sessionId: string, tx?: TransactionContext): Promise<MemorizationRecord[]>;
  listRecordsByStudent(studentId: string, direction: 'asc' | 'desc', page: PageRequest, tx?: TransactionContext): Promise<{ items: MemorizationRecord[]; total: number }>;
  listCorrectionsOfSession(sessionId: string, tx?: TransactionContext): Promise<MemorizationCorrection[]>;
  listAssignmentHistoryOfSession(sessionId: string, tx?: TransactionContext): Promise<AssignmentHistoryEntry[]>;
}
