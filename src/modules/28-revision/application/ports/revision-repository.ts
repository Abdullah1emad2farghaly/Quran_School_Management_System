import type { PageRequest, TransactionContext } from '../../../00-shared-kernel/public';
import type { AssignmentHistoryEntry, RevisionAssignment } from '../../domain/entities/revision-assignment';
import type { RevisionCorrection, RevisionRecord } from '../../domain/entities/revision-record';

/** Persistence of revision (Module 28's own tables only). Nothing is ever deleted; both history tables are append-only (INSERT only). */
export interface RevisionRepository {
  /** Inserts the assignment and its DEFINED history entry. Returns false when the subject already has an ACTIVE assignment defined in the same session (unique index). */
  insertAssignment(assignment: RevisionAssignment, entry: AssignmentHistoryEntry, tx: TransactionContext): Promise<boolean>;
  /** FOR UPDATE. */
  lockAssignment(id: string, tx: TransactionContext): Promise<RevisionAssignment | undefined>;
  /** FOR UPDATE: every assignment defined in the session (all statuses); also serialises recording against defining. */
  lockAssignmentsDefinedInSession(sessionId: string, tx: TransactionContext): Promise<RevisionAssignment[]>;
  /** Writes the new range/status of an assignment AND appends its history entry, together. */
  applyAssignmentChange(assignment: RevisionAssignment, entry: AssignmentHistoryEntry, tx: TransactionContext): Promise<void>;
  findAssignment(id: string, tx?: TransactionContext): Promise<RevisionAssignment | undefined>;
  listAssignmentsDefinedInSession(sessionId: string, tx?: TransactionContext): Promise<RevisionAssignment[]>;
  /** ACTIVE assignments of a group (any defining session). */
  listActiveAssignmentsOfGroup(groupId: string, tx?: TransactionContext): Promise<RevisionAssignment[]>;
  /** Of these assignments, the ones that have a fulfilling record (matches = true) in a session that STARTED BEFORE `before`. */
  fulfilledBefore(assignmentIds: readonly string[], before: Date, tx?: TransactionContext): Promise<Set<string>>;

  insertRecords(records: readonly RevisionRecord[], sessionScheduledStart: Date, tx: TransactionContext): Promise<void>;
  /** FOR UPDATE. */
  lockRecord(id: string, tx: TransactionContext): Promise<RevisionRecord | undefined>;
  findRecord(id: string, tx?: TransactionContext): Promise<RevisionRecord | undefined>;
  /** Writes the corrected range of a record AND appends the correction entry (original value kept), together. */
  applyRecordCorrection(record: RevisionRecord, entry: RevisionCorrection, tx: TransactionContext): Promise<void>;
  listRecordsBySession(sessionId: string, tx?: TransactionContext): Promise<RevisionRecord[]>;
  listRecordsByStudent(studentId: string, direction: 'asc' | 'desc', page: PageRequest, tx?: TransactionContext): Promise<{ items: RevisionRecord[]; total: number }>;
  listCorrectionsOfSession(sessionId: string, tx?: TransactionContext): Promise<RevisionCorrection[]>;
  listAssignmentHistoryOfSession(sessionId: string, tx?: TransactionContext): Promise<AssignmentHistoryEntry[]>;
}
