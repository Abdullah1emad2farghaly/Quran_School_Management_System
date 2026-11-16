import { QueryTypes, UniqueConstraintError, type Sequelize } from 'sequelize';
import { pageOffset, type PageRequest, type TransactionContext } from '../../../../../00-shared-kernel/public';
import { sequelizeTransactionOf } from '../../../../../02-database/public';
import type { AttendanceRepository } from '../../../../application/ports/attendance-repository';
import { AttendanceRecord, type AttendanceCorrection } from '../../../../domain/entities/attendance-record';
import type { ActorRole, AttendanceStatus, SubjectType } from '../../../../domain/value-objects/attendance-status';

type Queryable = Pick<Sequelize, 'query'>;
type D = Date | string;

interface RecordRow {
  id: string; sessionId: string; schoolId: string; groupId: string; subjectType: SubjectType; subjectId: string; status: AttendanceStatus; occurrenceDate: string;
  scheduledStart: D; recordedBy: string; recordedByRole: ActorRole; recordedAt: D; updatedBy: string; updatedByRole: ActorRole; updatedAt: D;
}
interface CorrectionRow {
  id: string; recordId: string; sessionId: string; subjectType: SubjectType; subjectId: string; previousStatus: AttendanceStatus; newStatus: AttendanceStatus; reason: string;
  changedBy: string; changedByRole: ActorRole; changedAt: D;
}

const RECORD_SELECT = `
  SELECT id, session_id AS sessionId, school_id AS schoolId, group_id AS groupId, subject_type AS subjectType, subject_id AS subjectId, status,
         DATE_FORMAT(occurrence_date, '%Y-%m-%d') AS occurrenceDate, scheduled_start AS scheduledStart, recorded_by AS recordedBy, recorded_by_role AS recordedByRole,
         recorded_at AS recordedAt, updated_by AS updatedBy, updated_by_role AS updatedByRole, updated_at AS updatedAt
    FROM attendance_records`;

const asDate = (v: D): Date => (v instanceof Date ? v : new Date(v));

const toRecord = (r: RecordRow): AttendanceRecord =>
  AttendanceRecord.rehydrate({
    id: r.id, sessionId: r.sessionId, schoolId: r.schoolId, groupId: r.groupId, subjectType: r.subjectType, subjectId: r.subjectId, status: r.status, occurrenceDate: r.occurrenceDate,
    scheduledStart: asDate(r.scheduledStart), recordedBy: r.recordedBy, recordedByRole: r.recordedByRole, recordedAt: asDate(r.recordedAt), updatedBy: r.updatedBy,
    updatedByRole: r.updatedByRole, updatedAt: asDate(r.updatedAt),
  });

const toCorrection = (r: CorrectionRow): AttendanceCorrection => ({
  id: r.id, recordId: r.recordId, sessionId: r.sessionId, subjectType: r.subjectType, subjectId: r.subjectId, previousStatus: r.previousStatus, newStatus: r.newStatus, reason: r.reason,
  changedBy: r.changedBy, changedByRole: r.changedByRole, changedAt: asDate(r.changedAt),
});

/**
 * MariaDB AttendanceRepository (tables `attendance_records` and `attendance_correction_history`, Module 26 only). There is NO delete. The correction history is
 * APPEND-ONLY: this class only ever INSERTs into it. The unique (session, subject type, subject) index is what makes a second marking of the same subject a change
 * of the existing record and not a duplicate. Timestamps are UTC.
 */
export class SequelizeAttendanceRepository implements AttendanceRepository {
  constructor(private readonly db: Queryable) {}

  private t(tx?: TransactionContext) {
    return sequelizeTransactionOf(tx) ?? null;
  }

  async insertIfAbsent(record: AttendanceRecord, tx: TransactionContext): Promise<boolean> {
    const s = record.snapshot;
    try {
      await this.db.query(
        `INSERT INTO attendance_records (id, session_id, school_id, group_id, subject_type, subject_id, status, occurrence_date, scheduled_start, recorded_by, recorded_by_role, recorded_at, updated_by, updated_by_role, updated_at)
         VALUES (:id, :sessionId, :schoolId, :groupId, :subjectType, :subjectId, :status, :occurrenceDate, :scheduledStart, :recordedBy, :recordedByRole, :recordedAt, :updatedBy, :updatedByRole, :updatedAt)`,
        { replacements: { ...s }, transaction: this.t(tx) },
      );
      return true;
    } catch (error) {
      if (error instanceof UniqueConstraintError) return false;
      throw error;
    }
  }

  async lockSubjects(sessionId: string, subjectType: SubjectType, subjectIds: readonly string[], tx: TransactionContext): Promise<AttendanceRecord[]> {
    if (subjectIds.length === 0) return [];
    const rows = await this.db.query<RecordRow>(`${RECORD_SELECT} WHERE session_id = :sessionId AND subject_type = :subjectType AND subject_id IN (:subjectIds) ORDER BY id ASC FOR UPDATE`, {
      replacements: { sessionId, subjectType, subjectIds: [...subjectIds] }, type: QueryTypes.SELECT, transaction: this.t(tx),
    });
    return rows.map(toRecord);
  }

  async applyCorrection(record: AttendanceRecord, c: AttendanceCorrection, tx: TransactionContext): Promise<void> {
    const s = record.snapshot;
    const [, affected] = await this.db.query(`UPDATE attendance_records SET status = :status, updated_by = :updatedBy, updated_by_role = :updatedByRole, updated_at = :updatedAt WHERE id = :id`, {
      replacements: { id: s.id, status: s.status, updatedBy: s.updatedBy, updatedByRole: s.updatedByRole, updatedAt: s.updatedAt }, type: QueryTypes.UPDATE, transaction: this.t(tx),
    });
    if (Number(affected) < 1) throw new Error('attendance record not stored');
    // Append-only history: INSERT only, in the same transaction as the status change.
    await this.db.query(
      `INSERT INTO attendance_correction_history (id, record_id, session_id, subject_type, subject_id, previous_status, new_status, reason, changed_by, changed_by_role, changed_at)
       VALUES (:id, :recordId, :sessionId, :subjectType, :subjectId, :previousStatus, :newStatus, :reason, :changedBy, :changedByRole, :changedAt)`,
      { replacements: { ...c }, transaction: this.t(tx) },
    );
  }

  async listBySession(sessionId: string, tx?: TransactionContext): Promise<AttendanceRecord[]> {
    const rows = await this.db.query<RecordRow>(`${RECORD_SELECT} WHERE session_id = :sessionId ORDER BY recorded_at ASC, id ASC`, { replacements: { sessionId }, type: QueryTypes.SELECT, transaction: this.t(tx) });
    return rows.map(toRecord);
  }

  async listByStudent(studentId: string, direction: 'asc' | 'desc', page: PageRequest, tx?: TransactionContext): Promise<{ items: AttendanceRecord[]; total: number }> {
    const order = direction === 'asc' ? 'ASC' : 'DESC';
    const replacements = { studentId, limit: page.pageSize, offset: pageOffset(page) };
    const rows = await this.db.query<RecordRow>(`${RECORD_SELECT} WHERE subject_type = 'STUDENT' AND subject_id = :studentId ORDER BY scheduled_start ${order}, id ASC LIMIT :limit OFFSET :offset`, { replacements, type: QueryTypes.SELECT, transaction: this.t(tx) });
    const counted = await this.db.query<{ total: number | string }>(`SELECT COUNT(*) AS total FROM attendance_records WHERE subject_type = 'STUDENT' AND subject_id = :studentId`, { replacements, type: QueryTypes.SELECT, transaction: this.t(tx) });
    return { items: rows.map(toRecord), total: Number(counted[0]?.total ?? 0) };
  }

  async listCorrectionsOfSession(sessionId: string, tx?: TransactionContext): Promise<AttendanceCorrection[]> {
    const rows = await this.db.query<CorrectionRow>(
      `SELECT id, record_id AS recordId, session_id AS sessionId, subject_type AS subjectType, subject_id AS subjectId, previous_status AS previousStatus, new_status AS newStatus, reason,
              changed_by AS changedBy, changed_by_role AS changedByRole, changed_at AS changedAt
         FROM attendance_correction_history WHERE session_id = :sessionId ORDER BY seq ASC`,
      { replacements: { sessionId }, type: QueryTypes.SELECT, transaction: this.t(tx) },
    );
    return rows.map(toCorrection);
  }
}
