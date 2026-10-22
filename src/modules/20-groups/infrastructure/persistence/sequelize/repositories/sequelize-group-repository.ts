import { QueryTypes, UniqueConstraintError, type Sequelize } from 'sequelize';
import type { PageRequest, TransactionContext } from '../../../../../00-shared-kernel/public';
import { sequelizeTransactionOf } from '../../../../../02-database/public';
import type { GroupListQuery, GroupRepository } from '../../../../application/ports/group-repository';
import { Group } from '../../../../domain/entities/group';
import { GroupAssignment, type AssignmentEndReason } from '../../../../domain/entities/group-assignment';
import type { GroupHistoryEntry } from '../../../../domain/entities/group-history-entry';
import { groupError } from '../../../../domain/errors/group-errors';
import type { GroupStatus, LearningMode, Progression } from '../../../../domain/value-objects/group-settings';

type Queryable = Pick<Sequelize, 'query'>;
type D = Date | string;

interface GroupRow {
  id: string; schoolId: string; organizationId: string; name: string; nameKey: string; teacherId: string | null; learningMode: LearningMode; progression: Progression;
  startingSurah: number | string; status: GroupStatus; createdBy: string; createdAt: D; updatedAt: D; version: number | string;
}
interface AssignmentRow {
  id: string; groupId: string; studentId: string; schoolId: string; organizationId: string; assignedAt: D; assignedBy: string; unassignedAt: D | null; unassignedBy: string | null; endReason: AssignmentEndReason | null;
}
interface HistoryRow {
  id: string; groupId: string; action: GroupHistoryEntry['action']; actorId: string; occurredAt: D; reason: string | null; previousName: string | null; newName: string | null;
  previousTeacherId: string | null; newTeacherId: string | null; previousLearningMode: LearningMode | null; newLearningMode: LearningMode | null; previousProgression: Progression | null;
  newProgression: Progression | null; previousStartingSurah: number | string | null; newStartingSurah: number | string | null;
}

const GROUP_SELECT = `
  SELECT g.id, g.school_id AS schoolId, g.organization_id AS organizationId, g.name, g.name_key AS nameKey, g.teacher_id AS teacherId, g.learning_mode AS learningMode,
         g.progression, g.starting_surah AS startingSurah, g.status, g.created_by AS createdBy, g.created_at AS createdAt, g.updated_at AS updatedAt, g.version
    FROM school_groups g`;
const ASSIGNMENT_SELECT = `
  SELECT id, group_id AS groupId, student_id AS studentId, school_id AS schoolId, organization_id AS organizationId, assigned_at AS assignedAt, assigned_by AS assignedBy,
         unassigned_at AS unassignedAt, unassigned_by AS unassignedBy, end_reason AS endReason
    FROM group_students`;
const HISTORY_SELECT = `
  SELECT id, group_id AS groupId, action, actor_id AS actorId, occurred_at AS occurredAt, reason, previous_name AS previousName, new_name AS newName,
         previous_teacher_id AS previousTeacherId, new_teacher_id AS newTeacherId, previous_learning_mode AS previousLearningMode, new_learning_mode AS newLearningMode,
         previous_progression AS previousProgression, new_progression AS newProgression, previous_starting_surah AS previousStartingSurah, new_starting_surah AS newStartingSurah
    FROM group_history`;
/** Whitelisted: the public sort key is mapped here, never interpolated from the client. */
const SORT_COLUMN = { createdAt: 'g.created_at', name: 'g.name' } as const;

const asDate = (v: D): Date => (v instanceof Date ? v : new Date(v));
const asDateOrNull = (v: D | null): Date | null => (v === null ? null : asDate(v));
const numOrNull = (v: number | string | null): number | null => (v === null ? null : Number(v));

export class SequelizeGroupRepository implements GroupRepository {
  constructor(private readonly db: Queryable) {}

  private t(tx?: TransactionContext) {
    return sequelizeTransactionOf(tx) ?? null;
  }

  async insert(group: Group, tx: TransactionContext): Promise<void> {
    const s = group.snapshot;
    try {
      await this.db.query(
        `INSERT INTO school_groups (id, school_id, organization_id, name, name_key, teacher_id, learning_mode, progression, starting_surah, status, active, created_by, version, created_at, updated_at)
         VALUES (:id, :schoolId, :organizationId, :name, :nameKey, :teacherId, :learningMode, :progression, :startingSurah, :status, 1, :createdBy, 1, :createdAt, :updatedAt)`,
        { replacements: { ...s }, transaction: this.t(tx) },
      );
    } catch (error) {
      // The unique (school, name key, active) index is the final guard: a concurrent creation of the same ACTIVE name already won.
      if (error instanceof UniqueConstraintError) throw groupError('GROUP_NAME_CONFLICT');
      throw error;
    }
  }

  async update(group: Group, tx: TransactionContext): Promise<void> {
    const s = group.snapshot;
    try {
      // The school and the organization are deliberately absent: they never change. `active` follows the status (NULL once ARCHIVED).
      const [, affected] = await this.db.query(
        `UPDATE school_groups SET name = :name, name_key = :nameKey, teacher_id = :teacherId, learning_mode = :learningMode, progression = :progression, starting_surah = :startingSurah,
                status = :status, active = IF(:status = 'ACTIVE', 1, NULL), updated_at = :updatedAt, version = version + 1
          WHERE id = :id AND version = :version`,
        { replacements: { ...s }, type: QueryTypes.UPDATE, transaction: this.t(tx) },
      );
      if (Number(affected) !== 1) throw groupError('GROUP_CONCURRENT_MODIFICATION');
    } catch (error) {
      if (error instanceof UniqueConstraintError) throw groupError('GROUP_NAME_CONFLICT');
      throw error;
    }
  }

  async insertHistory(entries: readonly GroupHistoryEntry[], tx: TransactionContext): Promise<void> {
    for (const e of entries) {
      await this.db.query(
        `INSERT INTO group_history (id, group_id, action, actor_id, occurred_at, reason, previous_name, new_name, previous_teacher_id, new_teacher_id, previous_learning_mode, new_learning_mode,
                                    previous_progression, new_progression, previous_starting_surah, new_starting_surah)
         VALUES (:id, :groupId, :action, :actorId, :occurredAt, :reason, :previousName, :newName, :previousTeacherId, :newTeacherId, :previousLearningMode, :newLearningMode,
                 :previousProgression, :newProgression, :previousStartingSurah, :newStartingSurah)`,
        { replacements: { ...e }, transaction: this.t(tx) },
      );
    }
  }

  async findById(id: string, tx?: TransactionContext): Promise<Group | undefined> {
    return (await this.groupsWhere('g.id = :value', { value: id }, '', tx))[0];
  }
  async lockById(id: string, tx: TransactionContext): Promise<Group | undefined> {
    return (await this.groupsWhere('g.id = :value', { value: id }, ' FOR UPDATE', tx))[0];
  }
  async findActiveByNameKey(schoolId: string, nameKey: string, tx?: TransactionContext): Promise<Group | undefined> {
    return (await this.groupsWhere('g.school_id = :schoolId AND g.name_key = :nameKey AND g.active = 1', { schoolId, nameKey }, '', tx))[0];
  }

  async listBySchool(schoolId: string, query: GroupListQuery, tx?: TransactionContext): Promise<{ items: Group[]; total: number }> {
    const statusClause = query.status && query.status.length > 0 ? ' AND g.status IN (:statuses)' : '';
    const replacements = { schoolId, ...(statusClause ? { statuses: [...query.status!] } : {}) };
    const direction = query.direction === 'asc' ? 'ASC' : 'DESC';
    return this.page(`g.school_id = :schoolId${statusClause}`, replacements, `ORDER BY ${SORT_COLUMN[query.sort]} ${direction}, g.id ASC`, query.page, tx);
  }
  listActiveByTeacher(teacherId: string, page: PageRequest, direction: 'asc' | 'desc', tx?: TransactionContext): Promise<{ items: Group[]; total: number }> {
    return this.page('g.teacher_id = :teacherId AND g.active = 1', { teacherId }, `ORDER BY g.name ${direction === 'asc' ? 'ASC' : 'DESC'}, g.id ASC`, page, tx);
  }

  async countActiveByTeacherInSchool(teacherId: string, schoolId: string, tx: TransactionContext): Promise<number> {
    // A locking read (not a snapshot read) so the unlink guard always sees the latest committed groups and blocks a concurrent assignment.
    const rows = await this.db.query<{ total: number | string }>('SELECT COUNT(*) AS total FROM school_groups WHERE teacher_id = :teacherId AND school_id = :schoolId AND active = 1 FOR UPDATE', {
      replacements: { teacherId, schoolId },
      type: QueryTypes.SELECT,
      transaction: this.t(tx),
    });
    return Number(rows[0]?.total ?? 0);
  }

  async listHistory(groupId: string, tx?: TransactionContext): Promise<GroupHistoryEntry[]> {
    const rows = await this.db.query<HistoryRow>(`${HISTORY_SELECT} WHERE group_id = :groupId ORDER BY seq ASC`, { replacements: { groupId }, type: QueryTypes.SELECT, transaction: this.t(tx) });
    return rows.map((r) => ({ ...r, occurredAt: asDate(r.occurredAt), previousStartingSurah: numOrNull(r.previousStartingSurah), newStartingSurah: numOrNull(r.newStartingSurah) }));
  }

  // ---------------------------------------------------------------------------------------------- assignments

  async insertAssignment(assignment: GroupAssignment, tx: TransactionContext): Promise<void> {
    const s = assignment.snapshot;
    try {
      await this.db.query(
        `INSERT INTO group_students (id, group_id, student_id, school_id, organization_id, assigned_at, assigned_by, unassigned_at, unassigned_by, end_reason, active)
         VALUES (:id, :groupId, :studentId, :schoolId, :organizationId, :assignedAt, :assignedBy, NULL, NULL, NULL, 1)`,
        { replacements: { ...s }, transaction: this.t(tx) },
      );
    } catch (error) {
      // The unique (student, active) index is the final guard: a concurrent assignment of the same student already won.
      if (error instanceof UniqueConstraintError) throw groupError('GROUP_STUDENT_ALREADY_ASSIGNED');
      throw error;
    }
  }

  async updateAssignment(assignment: GroupAssignment, tx: TransactionContext): Promise<void> {
    const s = assignment.snapshot;
    const [, affected] = await this.db.query('UPDATE group_students SET unassigned_at = :unassignedAt, unassigned_by = :unassignedBy, end_reason = :endReason, active = NULL WHERE id = :id AND active = 1', {
      replacements: { id: s.id, unassignedAt: s.unassignedAt, unassignedBy: s.unassignedBy, endReason: s.endReason },
      type: QueryTypes.UPDATE,
      transaction: this.t(tx),
    });
    if (Number(affected) !== 1) throw groupError('GROUP_CONCURRENT_MODIFICATION');
  }

  async findCurrentAssignmentOfStudent(studentId: string, tx?: TransactionContext): Promise<GroupAssignment | undefined> {
    return (await this.assignmentsWhere('student_id = :value AND active = 1', { value: studentId }, '', '', tx))[0];
  }
  async lockCurrentAssignmentOfStudent(studentId: string, tx: TransactionContext): Promise<GroupAssignment | undefined> {
    return (await this.assignmentsWhere('student_id = :value AND active = 1', { value: studentId }, '', ' FOR UPDATE', tx))[0];
  }
  listCurrentAssignments(groupId: string, tx?: TransactionContext): Promise<GroupAssignment[]> {
    return this.assignmentsWhere('group_id = :value AND active = 1', { value: groupId }, 'ORDER BY assigned_at ASC, id ASC', '', tx);
  }
  async listCurrentAssignmentsPage(groupId: string, page: PageRequest, direction: 'asc' | 'desc', tx?: TransactionContext): Promise<{ items: GroupAssignment[]; total: number }> {
    const counted = await this.db.query<{ total: number | string }>('SELECT COUNT(*) AS total FROM group_students WHERE group_id = :groupId AND active = 1', { replacements: { groupId }, type: QueryTypes.SELECT, transaction: this.t(tx) });
    const items = await this.assignmentsWhere('group_id = :value AND active = 1', { value: groupId }, `ORDER BY assigned_at ${direction === 'asc' ? 'ASC' : 'DESC'}, id ASC LIMIT ${Number(page.pageSize)} OFFSET ${(Number(page.page) - 1) * Number(page.pageSize)}`, '', tx);
    return { items, total: Number(counted[0]?.total ?? 0) };
  }
  listAssignmentsOfStudent(studentId: string, tx?: TransactionContext): Promise<GroupAssignment[]> {
    return this.assignmentsWhere('student_id = :value', { value: studentId }, 'ORDER BY assigned_at ASC, id ASC', '', tx);
  }
  async isStudentInActiveGroupOfTeacher(studentId: string, teacherId: string, tx?: TransactionContext): Promise<boolean> {
    const rows = await this.db.query<{ ok: number }>(
      'SELECT 1 AS ok FROM group_students gs JOIN school_groups g ON g.id = gs.group_id WHERE gs.student_id = :studentId AND gs.active = 1 AND g.teacher_id = :teacherId AND g.active = 1 LIMIT 1',
      { replacements: { studentId, teacherId }, type: QueryTypes.SELECT, transaction: this.t(tx) },
    );
    return rows.length > 0;
  }

  // ---------------------------------------------------------------------------------------------- internals

  private async groupsWhere(where: string, replacements: Record<string, unknown>, suffix: string, tx?: TransactionContext): Promise<Group[]> {
    const rows = await this.db.query<GroupRow>(`${GROUP_SELECT} WHERE ${where}${suffix}`, { replacements, type: QueryTypes.SELECT, transaction: this.t(tx) });
    return rows.map((r) => this.toGroup(r));
  }

  private async page(where: string, replacements: Record<string, unknown>, order: string, page: PageRequest, tx?: TransactionContext): Promise<{ items: Group[]; total: number }> {
    const transaction = this.t(tx);
    const counted = await this.db.query<{ total: number | string }>(`SELECT COUNT(*) AS total FROM school_groups g WHERE ${where}`, { replacements, type: QueryTypes.SELECT, transaction });
    const rows = await this.db.query<GroupRow>(`${GROUP_SELECT} WHERE ${where} ${order} LIMIT :limit OFFSET :offset`, {
      replacements: { ...replacements, limit: page.pageSize, offset: (page.page - 1) * page.pageSize },
      type: QueryTypes.SELECT,
      transaction,
    });
    return { items: rows.map((r) => this.toGroup(r)), total: Number(counted[0]?.total ?? 0) };
  }

  private async assignmentsWhere(where: string, replacements: Record<string, unknown>, order: string, lock: string, tx?: TransactionContext): Promise<GroupAssignment[]> {
    const rows = await this.db.query<AssignmentRow>(`${ASSIGNMENT_SELECT} WHERE ${where} ${order}${lock}`, { replacements, type: QueryTypes.SELECT, transaction: this.t(tx) });
    return rows.map((r) => GroupAssignment.rehydrate({ ...r, assignedAt: asDate(r.assignedAt), unassignedAt: asDateOrNull(r.unassignedAt) }));
  }

  private toGroup(r: GroupRow): Group {
    return Group.rehydrate({
      id: r.id, schoolId: r.schoolId, organizationId: r.organizationId, name: r.name, nameKey: r.nameKey, teacherId: r.teacherId, learningMode: r.learningMode, progression: r.progression,
      startingSurah: Number(r.startingSurah), status: r.status, createdBy: r.createdBy, createdAt: asDate(r.createdAt), updatedAt: asDate(r.updatedAt), version: Number(r.version),
    });
  }
}
