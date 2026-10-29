import { QueryTypes, UniqueConstraintError, type Sequelize } from 'sequelize';
import type { TransactionContext } from '../../../../../00-shared-kernel/public';
import { sequelizeTransactionOf } from '../../../../../02-database/public';
import type { ScheduleRepository } from '../../../../application/ports/schedule-repository';
import { GroupScheduleSlot, type SlotRetireReason } from '../../../../domain/entities/group-schedule-slot';
import { scheduleError } from '../../../../domain/errors/schedule-errors';
import { dayOfIsoNumber, isoNumberOf } from '../../../../domain/value-objects/schedule-time';

type Queryable = Pick<Sequelize, 'query'>;
type D = Date | string;

interface SlotRow {
  id: string; groupId: string; schoolId: string; dayOfWeek: number | string; startMinute: number | string; endMinute: number | string; createdAt: D; createdBy: string;
  retiredAt: D | null; retiredBy: string | null; retireReason: SlotRetireReason | null; replacedBySlotId: string | null;
}

const SLOT_SELECT = `
  SELECT id, group_id AS groupId, school_id AS schoolId, day_of_week AS dayOfWeek, start_minute AS startMinute, end_minute AS endMinute, created_at AS createdAt,
         created_by AS createdBy, retired_at AS retiredAt, retired_by AS retiredBy, retire_reason AS retireReason, replaced_by_slot_id AS replacedBySlotId
    FROM group_schedule_slots`;

const asDate = (v: D): Date => (v instanceof Date ? v : new Date(v));

interface DriverError {
  errno?: number;
  code?: string;
}
/** InnoDB deadlock (ER_LOCK_DEADLOCK, 1213), on the error, its `parent` or its `original`. */
function isDeadlock(error: unknown): boolean {
  const e = error as (DriverError & { parent?: DriverError; original?: DriverError }) | null | undefined;
  return [e, e?.parent, e?.original].some((c) => c != null && (c.errno === 1213 || c.code === 'ER_LOCK_DEADLOCK'));
}

function toSlot(row: SlotRow): GroupScheduleSlot {
  return GroupScheduleSlot.rehydrate({
    id: row.id,
    groupId: row.groupId,
    schoolId: row.schoolId,
    dayOfWeek: dayOfIsoNumber(Number(row.dayOfWeek)),
    startMinute: Number(row.startMinute),
    endMinute: Number(row.endMinute),
    createdAt: asDate(row.createdAt),
    createdBy: row.createdBy,
    retiredAt: row.retiredAt === null ? null : asDate(row.retiredAt),
    retiredBy: row.retiredBy,
    retireReason: row.retireReason,
    replacedBySlotId: row.replacedBySlotId,
  });
}

/**
 * MariaDB ScheduleRepository (tables `group_schedule_slots` and `schedule_teacher_locks` of Module 23 only). There is NO delete: a retired slot stays as history.
 * A deadlock between two concurrent schedule changes is reported as SCHEDULE_CONCURRENT_MODIFICATION (retryable); the service runs it again.
 */
export class SequelizeScheduleRepository implements ScheduleRepository {
  constructor(private readonly db: Queryable) {}

  private t(tx?: TransactionContext) {
    return sequelizeTransactionOf(tx) ?? null;
  }

  private async guarded<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (isDeadlock(error)) throw scheduleError('SCHEDULE_CONCURRENT_MODIFICATION');
      throw error;
    }
  }

  async insert(slot: GroupScheduleSlot, teacherId: string | null, tx: TransactionContext): Promise<void> {
    const s = slot.snapshot;
    await this.guarded(async () => {
      try {
        await this.db.query(
          `INSERT INTO group_schedule_slots (id, group_id, school_id, teacher_id, day_of_week, start_minute, end_minute, active, created_at, created_by)
           VALUES (:id, :groupId, :schoolId, :teacherId, :day, :start, :end, 1, :createdAt, :createdBy)`,
          { replacements: { id: s.id, groupId: s.groupId, schoolId: s.schoolId, teacherId, day: isoNumberOf(s.dayOfWeek), start: s.startMinute, end: s.endMinute, createdAt: s.createdAt, createdBy: s.createdBy }, transaction: this.t(tx) },
        );
      } catch (error) {
        if (error instanceof UniqueConstraintError) throw scheduleError('SCHEDULE_DAY_ALREADY_HAS_SLOT', { dayOfWeek: s.dayOfWeek });
        throw error;
      }
    });
  }

  async setTeacherOfGroup(groupId: string, teacherId: string | null, tx: TransactionContext): Promise<void> {
    await this.guarded(() => this.db.query('UPDATE group_schedule_slots SET teacher_id = :teacherId WHERE group_id = :groupId AND active = 1', { replacements: { groupId, teacherId }, transaction: this.t(tx) }));
  }

  async retire(slot: GroupScheduleSlot, tx: TransactionContext): Promise<void> {
    const s = slot.snapshot;
    await this.guarded(async () => {
      const [, affected] = await this.db.query(
        `UPDATE group_schedule_slots SET active = NULL, retired_at = :retiredAt, retired_by = :retiredBy, retire_reason = :reason, replaced_by_slot_id = :replacedBy
          WHERE id = :id AND active = 1`,
        { replacements: { id: s.id, retiredAt: s.retiredAt, retiredBy: s.retiredBy, reason: s.retireReason, replacedBy: s.replacedBySlotId }, type: QueryTypes.UPDATE, transaction: this.t(tx) },
      );
      if (Number(affected) !== 1) throw scheduleError('SCHEDULE_SLOT_NOT_FOUND');
    });
  }

  async lockById(id: string, tx: TransactionContext): Promise<GroupScheduleSlot | undefined> {
    const rows = await this.guarded(() => this.db.query<SlotRow>(`${SLOT_SELECT} WHERE id = :id FOR UPDATE`, { replacements: { id }, type: QueryTypes.SELECT, transaction: this.t(tx) }));
    return rows[0] ? toSlot(rows[0]) : undefined;
  }

  async listActiveByGroup(groupId: string, tx?: TransactionContext, lock = false): Promise<GroupScheduleSlot[]> {
    const rows = await this.guarded(() =>
      this.db.query<SlotRow>(`${SLOT_SELECT} WHERE group_id = :groupId AND active = 1 ORDER BY seq ASC${lock ? ' LOCK IN SHARE MODE' : ''}`, { replacements: { groupId }, type: QueryTypes.SELECT, transaction: this.t(tx) }),
    );
    return rows.map(toSlot);
  }

  async listAllByGroup(groupId: string, tx?: TransactionContext): Promise<GroupScheduleSlot[]> {
    const rows = await this.db.query<SlotRow>(`${SLOT_SELECT} WHERE group_id = :groupId ORDER BY seq ASC`, { replacements: { groupId }, type: QueryTypes.SELECT, transaction: this.t(tx) });
    return rows.map(toSlot);
  }

  async listActiveByGroups(groupIds: readonly string[], tx?: TransactionContext): Promise<GroupScheduleSlot[]> {
    if (groupIds.length === 0) return [];
    const rows = await this.db.query<SlotRow>(`${SLOT_SELECT} WHERE group_id IN (:groupIds) AND active = 1 ORDER BY seq ASC`, { replacements: { groupIds: [...groupIds] }, type: QueryTypes.SELECT, transaction: this.t(tx) });
    return rows.map(toSlot);
  }

  async listActiveByTeacher(teacherId: string, exceptGroupId: string | null, tx?: TransactionContext, lock = false): Promise<GroupScheduleSlot[]> {
    const rows = await this.guarded(() =>
      this.db.query<SlotRow>(`${SLOT_SELECT} WHERE teacher_id = :teacherId AND active = 1${exceptGroupId ? ' AND group_id <> :exceptGroupId' : ''} ORDER BY seq ASC${lock ? ' LOCK IN SHARE MODE' : ''}`, {
        replacements: { teacherId, exceptGroupId },
        type: QueryTypes.SELECT,
        transaction: this.t(tx),
      }),
    );
    return rows.map(toSlot);
  }

  /**
   * One row per Teacher, locked FOR UPDATE by an upsert (the first time it creates the row), always in sorted order so two requests never wait for each
   * other's locks in a different order. The row holds no data: it only serializes the schedule changes of one Teacher.
   */
  async lockTeachers(teacherIds: readonly string[], tx: TransactionContext): Promise<void> {
    for (const teacherId of [...new Set(teacherIds)].sort()) {
      await this.guarded(() =>
        this.db.query('INSERT INTO schedule_teacher_locks (teacher_id, locked_at) VALUES (:teacherId, NOW(3)) ON DUPLICATE KEY UPDATE locked_at = NOW(3)', {
          replacements: { teacherId },
          transaction: this.t(tx),
        }),
      );
    }
  }
}
