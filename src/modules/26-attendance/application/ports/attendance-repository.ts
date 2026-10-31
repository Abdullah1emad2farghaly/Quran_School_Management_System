import type { PageRequest, TransactionContext } from '../../../00-shared-kernel/public';
import type { AttendanceCorrection, AttendanceRecord } from '../../domain/entities/attendance-record';
import type { SubjectType } from '../../domain/value-objects/attendance-status';

/** Persistence of attendance (Module 26's own tables only). Records and corrections are NEVER deleted; the correction history is append-only. */
export interface AttendanceRepository {
  /** Inserts the record unless (session, subject) already has one (unique index). Returns whether it was inserted. */
  insertIfAbsent(record: AttendanceRecord, tx: TransactionContext): Promise<boolean>;
  /** FOR UPDATE: the existing records of these subjects for the session. */
  lockSubjects(sessionId: string, subjectType: SubjectType, subjectIds: readonly string[], tx: TransactionContext): Promise<AttendanceRecord[]>;
  /** Writes the new status of a record AND appends its correction entry, together (never one without the other). */
  applyCorrection(record: AttendanceRecord, correction: AttendanceCorrection, tx: TransactionContext): Promise<void>;
  listBySession(sessionId: string, tx?: TransactionContext): Promise<AttendanceRecord[]>;
  /** A student's records, by session date (newest first by default). */
  listByStudent(studentId: string, direction: 'asc' | 'desc', page: PageRequest, tx?: TransactionContext): Promise<{ items: AttendanceRecord[]; total: number }>;
  /** The correction history of a session (oldest first). Read by tests now and by the History & Audit module later. */
  listCorrectionsOfSession(sessionId: string, tx?: TransactionContext): Promise<AttendanceCorrection[]>;
}
