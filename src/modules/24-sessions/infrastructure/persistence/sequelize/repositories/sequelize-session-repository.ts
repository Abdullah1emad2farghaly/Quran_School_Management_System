import { QueryTypes, UniqueConstraintError, type Sequelize } from 'sequelize';
import { pageOffset, type PageRequest, type TransactionContext } from '../../../../../00-shared-kernel/public';
import { sequelizeTransactionOf } from '../../../../../02-database/public';
import type { ClassSessionRepository, SessionListFilter } from '../../../../application/ports/session-repository';
import { ClassSession } from '../../../../domain/entities/class-session';
import type { CancelSource, SessionStatus, SlotRetirementReason } from '../../../../domain/value-objects/session-status';

type Queryable = Pick<Sequelize, 'query'>;
type D = Date | string;

interface SessionRow {
  id: string; schoolId: string; groupId: string; teacherId: string; slotId: string; occurrenceDate: string; scheduledStart: D; scheduledEnd: D; status: SessionStatus;
  createdAt: D; startedAt: D | null; completedAt: D | null; cancelledAt: D | null; cancelledBy: string | null; cancelSource: CancelSource | null; cancelReason: string | null;
  slotRetireReason: SlotRetirementReason | null;
}

const SESSION_SELECT = `
  SELECT id, school_id AS schoolId, group_id AS groupId, teacher_id AS teacherId, slot_id AS slotId, DATE_FORMAT(occurrence_date, '%Y-%m-%d') AS occurrenceDate,
         scheduled_start AS scheduledStart, scheduled_end AS scheduledEnd, status, created_at AS createdAt, started_at AS startedAt, completed_at AS completedAt,
         cancelled_at AS cancelledAt, cancelled_by AS cancelledBy, cancel_source AS cancelSource, cancel_reason AS cancelReason, slot_retire_reason AS slotRetireReason
    FROM class_sessions`;

const asDate = (v: D): Date => (v instanceof Date ? v : new Date(v));
const asDateOrNull = (v: D | null): Date | null => (v === null ? null : asDate(v));

const toSession = (row: SessionRow): ClassSession =>
  ClassSession.rehydrate({
    id: row.id, schoolId: row.schoolId, groupId: row.groupId, teacherId: row.teacherId, slotId: row.slotId, occurrenceDate: row.occurrenceDate,
    scheduledStart: asDate(row.scheduledStart), scheduledEnd: asDate(row.scheduledEnd), status: row.status, createdAt: asDate(row.createdAt),
    startedAt: asDateOrNull(row.startedAt), completedAt: asDateOrNull(row.completedAt), cancelledAt: asDateOrNull(row.cancelledAt), cancelledBy: row.cancelledBy,
    cancelSource: row.cancelSource, cancelReason: row.cancelReason, slotRetireReason: row.slotRetireReason,
  });

/**
 * MariaDB ClassSessionRepository (table `class_sessions` of Module 24 only). There is NO delete. Timestamps are UTC. The unique (slot_id, occurrence_date)
 * index is what makes generation idempotent: a second insert for the same occurrence is simply "not inserted".
 */
export class SequelizeClassSessionRepository implements ClassSessionRepository {
  constructor(private readonly db: Queryable) {}

  private t(tx?: TransactionContext) {
    return sequelizeTransactionOf(tx) ?? null;
  }

  async insertIfAbsent(session: ClassSession, tx: TransactionContext): Promise<boolean> {
    const s = session.snapshot;
    try {
      await this.db.query(
        `INSERT INTO class_sessions (id, school_id, group_id, teacher_id, slot_id, occurrence_date, scheduled_start, scheduled_end, status, created_at)
         VALUES (:id, :schoolId, :groupId, :teacherId, :slotId, :occurrenceDate, :scheduledStart, :scheduledEnd, :status, :createdAt)`,
        { replacements: { id: s.id, schoolId: s.schoolId, groupId: s.groupId, teacherId: s.teacherId, slotId: s.slotId, occurrenceDate: s.occurrenceDate, scheduledStart: s.scheduledStart, scheduledEnd: s.scheduledEnd, status: s.status, createdAt: s.createdAt }, transaction: this.t(tx) },
      );
      return true;
    } catch (error) {
      if (error instanceof UniqueConstraintError) return false;
      throw error;
    }
  }

  async save(session: ClassSession, tx: TransactionContext): Promise<void> {
    const s = session.snapshot;
    const [, affected] = await this.db.query(
      `UPDATE class_sessions SET status = :status, started_at = :startedAt, completed_at = :completedAt, cancelled_at = :cancelledAt, cancelled_by = :cancelledBy,
              cancel_source = :cancelSource, cancel_reason = :cancelReason, slot_retire_reason = :slotRetireReason WHERE id = :id`,
      { replacements: { id: s.id, status: s.status, startedAt: s.startedAt, completedAt: s.completedAt, cancelledAt: s.cancelledAt, cancelledBy: s.cancelledBy, cancelSource: s.cancelSource, cancelReason: s.cancelReason, slotRetireReason: s.slotRetireReason }, type: QueryTypes.UPDATE, transaction: this.t(tx) },
    );
    if (Number(affected) < 1) throw new Error('class session not stored');
  }

  async lockById(id: string, tx: TransactionContext): Promise<ClassSession | undefined> {
    const rows = await this.db.query<SessionRow>(`${SESSION_SELECT} WHERE id = :id FOR UPDATE`, { replacements: { id }, type: QueryTypes.SELECT, transaction: this.t(tx) });
    return rows[0] ? toSession(rows[0]) : undefined;
  }

  async findById(id: string, tx?: TransactionContext): Promise<ClassSession | undefined> {
    const rows = await this.db.query<SessionRow>(`${SESSION_SELECT} WHERE id = :id`, { replacements: { id }, type: QueryTypes.SELECT, transaction: this.t(tx) });
    return rows[0] ? toSession(rows[0]) : undefined;
  }

  async lockOpenBySlot(slotId: string, tx: TransactionContext): Promise<ClassSession[]> {
    const rows = await this.db.query<SessionRow>(`${SESSION_SELECT} WHERE slot_id = :slotId AND status = 'OPEN' ORDER BY scheduled_start ASC FOR UPDATE`, { replacements: { slotId }, type: QueryTypes.SELECT, transaction: this.t(tx) });
    return rows.map(toSession);
  }

  async listDueIds(now: Date, limit: number, tx?: TransactionContext): Promise<string[]> {
    const rows = await this.db.query<{ id: string }>(
      `SELECT id FROM class_sessions
        WHERE (status = 'OPEN' AND scheduled_start <= :now) OR (status = 'IN_PROGRESS' AND scheduled_end <= :now)
        ORDER BY scheduled_start ASC LIMIT :limit`,
      { replacements: { now, limit }, type: QueryTypes.SELECT, transaction: this.t(tx) },
    );
    return rows.map((r) => r.id);
  }

  async listOpenSlotIds(tx?: TransactionContext): Promise<string[]> {
    const rows = await this.db.query<{ slotId: string }>(`SELECT DISTINCT slot_id AS slotId FROM class_sessions WHERE status = 'OPEN'`, { type: QueryTypes.SELECT, transaction: this.t(tx) });
    return rows.map((r) => r.slotId);
  }

  listByGroup(groupId: string, filter: SessionListFilter, page: PageRequest, tx?: TransactionContext) {
    return this.list('group_id', groupId, filter, page, tx);
  }

  listByTeacher(teacherId: string, filter: SessionListFilter, page: PageRequest, tx?: TransactionContext) {
    return this.list('teacher_id', teacherId, filter, page, tx);
  }

  /** `column` is one of two constants of this class, never client input. */
  private async list(column: 'group_id' | 'teacher_id', value: string, filter: SessionListFilter, page: PageRequest, tx?: TransactionContext): Promise<{ items: ClassSession[]; total: number }> {
    const statusClause = filter.status && filter.status.length > 0 ? ' AND status IN (:statuses)' : '';
    const replacements = { value, statuses: filter.status ? [...filter.status] : [], limit: page.pageSize, offset: pageOffset(page) };
    const direction = filter.direction === 'asc' ? 'ASC' : 'DESC';
    const rows = await this.db.query<SessionRow>(`${SESSION_SELECT} WHERE ${column} = :value${statusClause} ORDER BY scheduled_start ${direction}, id ASC LIMIT :limit OFFSET :offset`, { replacements, type: QueryTypes.SELECT, transaction: this.t(tx) });
    const counted = await this.db.query<{ total: number | string }>(`SELECT COUNT(*) AS total FROM class_sessions WHERE ${column} = :value${statusClause}`, { replacements, type: QueryTypes.SELECT, transaction: this.t(tx) });
    return { items: rows.map(toSession), total: Number(counted[0]?.total ?? 0) };
  }
}
