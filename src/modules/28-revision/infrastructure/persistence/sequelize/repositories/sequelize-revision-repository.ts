import { QueryTypes, UniqueConstraintError, type Sequelize } from 'sequelize';
import { pageOffset, type PageRequest, type TransactionContext } from '../../../../../00-shared-kernel/public';
import { sequelizeTransactionOf } from '../../../../../02-database/public';
import type { RevisionRepository } from '../../../../application/ports/revision-repository';
import { RevisionAssignment, subjectKeyOf, type AssignmentHistoryEntry } from '../../../../domain/entities/revision-assignment';
import { RevisionRecord, type RevisionCorrection } from '../../../../domain/entities/revision-record';
import type { AssignmentAction, AssignmentStatus, RevisionRange } from '../../../../domain/value-objects/revision-range';

type Queryable = Pick<Sequelize, 'query'>;
type D = Date | string;

interface AssignmentRow {
  id: string; schoolId: string; groupId: string; studentId: string | null; definedInSessionId: string; definedByTeacherId: string; definedByUserId: string; rangeJson: string;
  status: AssignmentStatus; createdAt: D; updatedAt: D;
}
interface RecordRow {
  id: string; sessionId: string; schoolId: string; groupId: string; studentId: string; assignmentId: string | null; rangeJson: string; matches: number | null;
  recordedBy: string; recordedAt: D; updatedBy: string; updatedAt: D;
}

interface CorrectionRow {
  id: string; recordId: string; sessionId: string; studentId: string; previousRange: string; newRange: string; previousMatches: number | null; newMatches: number | null; reason: string | null; changedBy: string; changedAt: D;
}
interface HistoryRow {
  id: string; assignmentId: string; sessionId: string; action: AssignmentAction; previousRange: string | null; newRange: string | null; changedBy: string; changedAt: D;
}

const ASSIGNMENT_SELECT = `
  SELECT id, school_id AS schoolId, group_id AS groupId, student_id AS studentId, defined_in_session_id AS definedInSessionId, defined_by_teacher_id AS definedByTeacherId,
         defined_by_user_id AS definedByUserId, range_json AS rangeJson, status, created_at AS createdAt, updated_at AS updatedAt
    FROM revision_assignments`;
const RECORD_SELECT = `
  SELECT id, session_id AS sessionId, school_id AS schoolId, group_id AS groupId, student_id AS studentId, assignment_id AS assignmentId, range_json AS rangeJson,
         matches_assignment AS matches, recorded_by AS recordedBy, recorded_at AS recordedAt, updated_by AS updatedBy, updated_at AS updatedAt
    FROM revision_records`;

const asDate = (v: D): Date => (v instanceof Date ? v : new Date(v));
const json = (range: RevisionRange | null): string | null => (range === null ? null : JSON.stringify(range));
const parse = (text: string | null): RevisionRange | null => (text === null ? null : (JSON.parse(text) as RevisionRange));
const bool = (v: number | null): boolean | null => (v === null ? null : Number(v) === 1);
const tiny = (v: boolean | null): number | null => (v === null ? null : v ? 1 : 0);

const toAssignment = (r: AssignmentRow): RevisionAssignment =>
  RevisionAssignment.rehydrate({
    id: r.id, schoolId: r.schoolId, groupId: r.groupId, studentId: r.studentId, definedInSessionId: r.definedInSessionId, definedByTeacherId: r.definedByTeacherId, definedByUserId: r.definedByUserId,
    range: parse(r.rangeJson) as RevisionRange, status: r.status, createdAt: asDate(r.createdAt), updatedAt: asDate(r.updatedAt),
  });
const toRecord = (r: RecordRow): RevisionRecord =>
  RevisionRecord.rehydrate({
    id: r.id, sessionId: r.sessionId, schoolId: r.schoolId, groupId: r.groupId, studentId: r.studentId, assignmentId: r.assignmentId, range: parse(r.rangeJson) as RevisionRange,
    matchesAssignment: bool(r.matches), recordedBy: r.recordedBy, recordedAt: asDate(r.recordedAt), updatedBy: r.updatedBy, updatedAt: asDate(r.updatedAt),
  });

/**
 * MariaDB RevisionRepository (tables `revision_assignments`, `revision_assignment_history`, `revision_records`, `revision_correction_history`, Module 28
 * only). There is NO delete. Both history tables are APPEND-ONLY: this class only ever INSERTs into them. The unique (session, subject, active_slot) index makes a second
 * ACTIVE assignment for the same subject and session impossible. Timestamps are UTC.
 */
export class SequelizeRevisionRepository implements RevisionRepository {
  constructor(private readonly db: Queryable) {}

  private t(tx?: TransactionContext) {
    return sequelizeTransactionOf(tx) ?? null;
  }

  async insertAssignment(assignment: RevisionAssignment, entry: AssignmentHistoryEntry, tx: TransactionContext): Promise<boolean> {
    const s = assignment.snapshot;
    try {
      await this.db.query(
        `INSERT INTO revision_assignments (id, school_id, group_id, student_id, subject_key, defined_in_session_id, defined_by_teacher_id, defined_by_user_id, range_json, status, active_slot, created_at, updated_at)
         VALUES (:id, :schoolId, :groupId, :studentId, :subjectKey, :definedInSessionId, :definedByTeacherId, :definedByUserId, :rangeJson, 'ACTIVE', 1, :createdAt, :updatedAt)`,
        { replacements: { ...s, subjectKey: subjectKeyOf(s.studentId), rangeJson: json(s.range) }, transaction: this.t(tx) },
      );
    } catch (error) {
      if (error instanceof UniqueConstraintError) return false;
      throw error;
    }
    await this.insertHistory(entry, tx);
    return true;
  }

  async lockAssignment(id: string, tx: TransactionContext): Promise<RevisionAssignment | undefined> {
    const rows = await this.db.query<AssignmentRow>(`${ASSIGNMENT_SELECT} WHERE id = :id FOR UPDATE`, { replacements: { id }, type: QueryTypes.SELECT, transaction: this.t(tx) });
    return rows[0] ? toAssignment(rows[0]) : undefined;
  }

  async lockAssignmentsDefinedInSession(sessionId: string, tx: TransactionContext): Promise<RevisionAssignment[]> {
    const rows = await this.db.query<AssignmentRow>(`${ASSIGNMENT_SELECT} WHERE defined_in_session_id = :sessionId ORDER BY created_at ASC, id ASC FOR UPDATE`, {
      replacements: { sessionId }, type: QueryTypes.SELECT, transaction: this.t(tx),
    });
    return rows.map(toAssignment);
  }

  async applyAssignmentChange(assignment: RevisionAssignment, entry: AssignmentHistoryEntry, tx: TransactionContext): Promise<void> {
    const s = assignment.snapshot;
    const [, affected] = await this.db.query(
      `UPDATE revision_assignments SET range_json = :rangeJson, status = :status, active_slot = :activeSlot, updated_at = :updatedAt WHERE id = :id`,
      { replacements: { id: s.id, rangeJson: json(s.range), status: s.status, activeSlot: s.status === 'ACTIVE' ? 1 : null, updatedAt: s.updatedAt }, type: QueryTypes.UPDATE, transaction: this.t(tx) },
    );
    if (Number(affected) < 1) throw new Error('revision assignment not stored');
    await this.insertHistory(entry, tx);
  }

  async findAssignment(id: string, tx?: TransactionContext): Promise<RevisionAssignment | undefined> {
    const rows = await this.db.query<AssignmentRow>(`${ASSIGNMENT_SELECT} WHERE id = :id`, { replacements: { id }, type: QueryTypes.SELECT, transaction: this.t(tx) });
    return rows[0] ? toAssignment(rows[0]) : undefined;
  }

  async listAssignmentsDefinedInSession(sessionId: string, tx?: TransactionContext): Promise<RevisionAssignment[]> {
    const rows = await this.db.query<AssignmentRow>(`${ASSIGNMENT_SELECT} WHERE defined_in_session_id = :sessionId ORDER BY created_at ASC, id ASC`, { replacements: { sessionId }, type: QueryTypes.SELECT, transaction: this.t(tx) });
    return rows.map(toAssignment);
  }

  async listActiveAssignmentsOfGroup(groupId: string, tx?: TransactionContext): Promise<RevisionAssignment[]> {
    const rows = await this.db.query<AssignmentRow>(`${ASSIGNMENT_SELECT} WHERE group_id = :groupId AND status = 'ACTIVE' ORDER BY created_at ASC, id ASC`, { replacements: { groupId }, type: QueryTypes.SELECT, transaction: this.t(tx) });
    return rows.map(toAssignment);
  }

  async fulfilledBefore(assignmentIds: readonly string[], before: Date, tx?: TransactionContext): Promise<Set<string>> {
    if (assignmentIds.length === 0) return new Set();
    const rows = await this.db.query<{ assignmentId: string }>(
      `SELECT DISTINCT assignment_id AS assignmentId FROM revision_records WHERE assignment_id IN (:ids) AND matches_assignment = 1 AND session_scheduled_start < :before`,
      { replacements: { ids: [...assignmentIds], before }, type: QueryTypes.SELECT, transaction: this.t(tx) },
    );
    return new Set(rows.map((r: { assignmentId: string }) => r.assignmentId));
  }

  async insertRecords(records: readonly RevisionRecord[], sessionScheduledStart: Date, tx: TransactionContext): Promise<void> {
    for (const record of records) {
      const s = record.snapshot;
      await this.db.query(
        `INSERT INTO revision_records (id, session_id, school_id, group_id, student_id, assignment_id, range_json, matches_assignment, session_scheduled_start, recorded_by, recorded_at, updated_by, updated_at)
         VALUES (:id, :sessionId, :schoolId, :groupId, :studentId, :assignmentId, :rangeJson, :matches, :sessionScheduledStart, :recordedBy, :recordedAt, :updatedBy, :updatedAt)`,
        { replacements: { ...s, rangeJson: json(s.range), matches: tiny(s.matchesAssignment), sessionScheduledStart }, transaction: this.t(tx) },
      );
    }
  }

  async lockRecord(id: string, tx: TransactionContext): Promise<RevisionRecord | undefined> {
    const rows = await this.db.query<RecordRow>(`${RECORD_SELECT} WHERE id = :id FOR UPDATE`, { replacements: { id }, type: QueryTypes.SELECT, transaction: this.t(tx) });
    return rows[0] ? toRecord(rows[0]) : undefined;
  }

  async findRecord(id: string, tx?: TransactionContext): Promise<RevisionRecord | undefined> {
    const rows = await this.db.query<RecordRow>(`${RECORD_SELECT} WHERE id = :id`, { replacements: { id }, type: QueryTypes.SELECT, transaction: this.t(tx) });
    return rows[0] ? toRecord(rows[0]) : undefined;
  }

  async applyRecordCorrection(record: RevisionRecord, c: RevisionCorrection, tx: TransactionContext): Promise<void> {
    const s = record.snapshot;
    const [, affected] = await this.db.query(
      `UPDATE revision_records SET range_json = :rangeJson, matches_assignment = :matches, updated_by = :updatedBy, updated_at = :updatedAt WHERE id = :id`,
      { replacements: { id: s.id, rangeJson: json(s.range), matches: tiny(s.matchesAssignment), updatedBy: s.updatedBy, updatedAt: s.updatedAt }, type: QueryTypes.UPDATE, transaction: this.t(tx) },
    );
    if (Number(affected) < 1) throw new Error('revision record not stored');
    // Append-only history: INSERT only, in the same transaction as the change. The ORIGINAL value is `previous_range_json`.
    await this.db.query(
      `INSERT INTO revision_correction_history (id, record_id, session_id, student_id, previous_range_json, new_range_json, previous_matches, new_matches, reason, changed_by, changed_at)
       VALUES (:id, :recordId, :sessionId, :studentId, :previousRange, :newRange, :previousMatches, :newMatches, :reason, :changedBy, :changedAt)`,
      { replacements: { ...c, previousRange: json(c.previousRange), newRange: json(c.newRange), previousMatches: tiny(c.previousMatches), newMatches: tiny(c.newMatches) }, transaction: this.t(tx) },
    );
  }

  async listRecordsBySession(sessionId: string, tx?: TransactionContext): Promise<RevisionRecord[]> {
    const rows = await this.db.query<RecordRow>(`${RECORD_SELECT} WHERE session_id = :sessionId ORDER BY recorded_at ASC, id ASC`, { replacements: { sessionId }, type: QueryTypes.SELECT, transaction: this.t(tx) });
    return rows.map(toRecord);
  }

  async listRecordsByStudent(studentId: string, direction: 'asc' | 'desc', page: PageRequest, tx?: TransactionContext): Promise<{ items: RevisionRecord[]; total: number }> {
    const order = direction === 'asc' ? 'ASC' : 'DESC';
    const replacements = { studentId, limit: page.pageSize, offset: pageOffset(page) };
    const rows = await this.db.query<RecordRow>(`${RECORD_SELECT} WHERE student_id = :studentId ORDER BY session_scheduled_start ${order}, recorded_at ${order}, id ASC LIMIT :limit OFFSET :offset`, { replacements, type: QueryTypes.SELECT, transaction: this.t(tx) });
    const counted = await this.db.query<{ total: number | string }>(`SELECT COUNT(*) AS total FROM revision_records WHERE student_id = :studentId`, { replacements, type: QueryTypes.SELECT, transaction: this.t(tx) });
    return { items: rows.map(toRecord), total: Number(counted[0]?.total ?? 0) };
  }

  async listCorrectionsOfSession(sessionId: string, tx?: TransactionContext): Promise<RevisionCorrection[]> {
    const rows = await this.db.query<CorrectionRow>(
      `SELECT id, record_id AS recordId, session_id AS sessionId, student_id AS studentId, previous_range_json AS previousRange, new_range_json AS newRange, previous_matches AS previousMatches,
              new_matches AS newMatches, reason, changed_by AS changedBy, changed_at AS changedAt
         FROM revision_correction_history WHERE session_id = :sessionId ORDER BY seq ASC`,
      { replacements: { sessionId }, type: QueryTypes.SELECT, transaction: this.t(tx) },
    );
    return rows.map((r: CorrectionRow) => ({
      id: r.id, recordId: r.recordId, sessionId: r.sessionId, studentId: r.studentId, previousRange: parse(r.previousRange) as RevisionRange, newRange: parse(r.newRange) as RevisionRange,
      previousMatches: bool(r.previousMatches), newMatches: bool(r.newMatches), reason: r.reason, changedBy: r.changedBy, changedAt: asDate(r.changedAt),
    }));
  }

  async listAssignmentHistoryOfSession(sessionId: string, tx?: TransactionContext): Promise<AssignmentHistoryEntry[]> {
    const rows = await this.db.query<HistoryRow>(
      `SELECT id, assignment_id AS assignmentId, session_id AS sessionId, action, previous_range_json AS previousRange, new_range_json AS newRange, changed_by AS changedBy, changed_at AS changedAt
         FROM revision_assignment_history WHERE session_id = :sessionId ORDER BY seq ASC`,
      { replacements: { sessionId }, type: QueryTypes.SELECT, transaction: this.t(tx) },
    );
    return rows.map((r: HistoryRow) => ({ id: r.id, assignmentId: r.assignmentId, sessionId: r.sessionId, action: r.action, previousRange: parse(r.previousRange), newRange: parse(r.newRange), changedBy: r.changedBy, changedAt: asDate(r.changedAt) }));
  }

  private async insertHistory(entry: AssignmentHistoryEntry, tx: TransactionContext): Promise<void> {
    await this.db.query(
      `INSERT INTO revision_assignment_history (id, assignment_id, session_id, action, previous_range_json, new_range_json, changed_by, changed_at)
       VALUES (:id, :assignmentId, :sessionId, :action, :previousRange, :newRange, :changedBy, :changedAt)`,
      { replacements: { ...entry, previousRange: json(entry.previousRange), newRange: json(entry.newRange) }, transaction: this.t(tx) },
    );
  }
}
