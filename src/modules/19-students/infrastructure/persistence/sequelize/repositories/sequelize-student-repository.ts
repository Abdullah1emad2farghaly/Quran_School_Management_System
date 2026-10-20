import { QueryTypes, UniqueConstraintError, type Sequelize } from 'sequelize';
import type { TransactionContext } from '../../../../../00-shared-kernel/public';
import { sequelizeTransactionOf } from '../../../../../02-database/public';
import type { StudentListQuery, StudentRepository } from '../../../../application/ports/student-repository';
import { Student } from '../../../../domain/entities/student';
import type { StudentHistoryEntry } from '../../../../domain/entities/student-history-entry';
import { studentError } from '../../../../domain/errors/student-errors';
import type { StudentStatus } from '../../../../domain/value-objects/student-status';

type Queryable = Pick<Sequelize, 'query'>;

interface StudentRow {
  id: string;
  schoolId: string;
  organizationId: string;
  parentId: string;
  fullName: string;
  nationalId: string;
  joinDate: string;
  status: StudentStatus;
  createdBy: string;
  createdAt: Date | string;
  updatedAt: Date | string;
  version: number | string;
}
interface HistoryRow {
  id: string;
  studentId: string;
  action: StudentHistoryEntry['action'];
  actorId: string;
  occurredAt: Date | string;
  reason: string | null;
  previousStatus: StudentStatus | null;
  newStatus: StudentStatus | null;
  previousFullName: string | null;
  newFullName: string | null;
  previousJoinDate: string | null;
  newJoinDate: string | null;
}

// join_date is selected as text so the business date never shifts with the driver's time zone handling.
const SELECT = `
  SELECT s.id, s.school_id AS schoolId, s.organization_id AS organizationId, s.parent_id AS parentId, s.full_name AS fullName,
         s.national_id AS nationalId, DATE_FORMAT(s.join_date, '%Y-%m-%d') AS joinDate, s.status, s.created_by AS createdBy,
         s.created_at AS createdAt, s.updated_at AS updatedAt, s.version
    FROM students s`;
const SELECT_HISTORY = `
  SELECT id, student_id AS studentId, action, actor_id AS actorId, occurred_at AS occurredAt, reason, previous_status AS previousStatus,
         new_status AS newStatus, previous_full_name AS previousFullName, new_full_name AS newFullName,
         DATE_FORMAT(previous_join_date, '%Y-%m-%d') AS previousJoinDate, DATE_FORMAT(new_join_date, '%Y-%m-%d') AS newJoinDate
    FROM student_history`;
/** Whitelisted: the public sort key is mapped here, never interpolated from the client. */
const SORT_COLUMN = { createdAt: 's.created_at', joinDate: 's.join_date', fullName: 's.full_name' } as const;

const asDate = (value: Date | string): Date => (value instanceof Date ? value : new Date(value));

export class SequelizeStudentRepository implements StudentRepository {
  constructor(private readonly db: Queryable) {}

  async insert(student: Student, tx: TransactionContext): Promise<void> {
    const s = student.snapshot;
    try {
      await this.db.query(
        `INSERT INTO students (id, school_id, organization_id, parent_id, full_name, national_id, join_date, status, created_by, version, created_at, updated_at)
         VALUES (:id, :schoolId, :organizationId, :parentId, :fullName, :nationalId, :joinDate, :status, :createdBy, 1, :createdAt, :updatedAt)`,
        { replacements: { ...s }, transaction: sequelizeTransactionOf(tx) ?? null },
      );
    } catch (error) {
      // The unique index on national_id is the final guard: a concurrent registration of the same National ID already won.
      if (error instanceof UniqueConstraintError) throw studentError('STUDENT_NATIONAL_ID_CONFLICT');
      throw error;
    }
  }

  async update(student: Student, tx: TransactionContext): Promise<void> {
    const s = student.snapshot;
    // The parent, the school and the National ID are deliberately absent: they never change.
    const [, affected] = await this.db.query(
      'UPDATE students SET full_name = :fullName, join_date = :joinDate, status = :status, updated_at = :updatedAt, version = version + 1 WHERE id = :id AND version = :version',
      { replacements: { id: s.id, version: s.version, fullName: s.fullName, joinDate: s.joinDate, status: s.status, updatedAt: s.updatedAt }, type: QueryTypes.UPDATE, transaction: sequelizeTransactionOf(tx) ?? null },
    );
    if (Number(affected) !== 1) throw studentError('STUDENT_CONCURRENT_MODIFICATION');
  }

  async insertHistory(entries: readonly StudentHistoryEntry[], tx: TransactionContext): Promise<void> {
    for (const e of entries) {
      await this.db.query(
        `INSERT INTO student_history (id, student_id, action, actor_id, occurred_at, reason, previous_status, new_status, previous_full_name, new_full_name, previous_join_date, new_join_date)
         VALUES (:id, :studentId, :action, :actorId, :occurredAt, :reason, :previousStatus, :newStatus, :previousFullName, :newFullName, :previousJoinDate, :newJoinDate)`,
        { replacements: { ...e }, transaction: sequelizeTransactionOf(tx) ?? null },
      );
    }
  }

  async findById(id: string, tx?: TransactionContext): Promise<Student | undefined> {
    return (await this.find(`${SELECT} WHERE s.id = :value`, id, tx))[0];
  }
  async lockById(id: string, tx: TransactionContext): Promise<Student | undefined> {
    return (await this.find(`${SELECT} WHERE s.id = :value FOR UPDATE`, id, tx))[0];
  }
  async findByNationalId(nationalId: string, tx?: TransactionContext): Promise<Student | undefined> {
    return (await this.find(`${SELECT} WHERE s.national_id = :value`, nationalId, tx))[0];
  }

  listBySchool(schoolId: string, query: StudentListQuery, tx?: TransactionContext): Promise<{ items: Student[]; total: number }> {
    return this.list('s.school_id = :ownerId', schoolId, query, tx);
  }
  listByParent(parentId: string, query: StudentListQuery, tx?: TransactionContext): Promise<{ items: Student[]; total: number }> {
    return this.list('s.parent_id = :ownerId', parentId, query, tx);
  }

  async countByParentInSchool(parentId: string, schoolId: string, tx: TransactionContext): Promise<number> {
    // A locking read (not a snapshot read) so the unlink guard always sees the latest committed students and blocks a concurrent registration.
    const rows = await this.db.query<{ total: number | string }>('SELECT COUNT(*) AS total FROM students WHERE parent_id = :parentId AND school_id = :schoolId FOR UPDATE', {
      replacements: { parentId, schoolId },
      type: QueryTypes.SELECT,
      transaction: sequelizeTransactionOf(tx) ?? null,
    });
    return Number(rows[0]?.total ?? 0);
  }

  async listHistory(studentId: string, tx?: TransactionContext): Promise<StudentHistoryEntry[]> {
    const rows = await this.db.query<HistoryRow>(`${SELECT_HISTORY} WHERE student_id = :studentId ORDER BY seq ASC`, {
      replacements: { studentId },
      type: QueryTypes.SELECT,
      transaction: sequelizeTransactionOf(tx) ?? null,
    });
    return rows.map((r) => ({ ...r, occurredAt: asDate(r.occurredAt) }));
  }

  private async list(where: string, ownerId: string, query: StudentListQuery, tx?: TransactionContext): Promise<{ items: Student[]; total: number }> {
    const transaction = sequelizeTransactionOf(tx) ?? null;
    const statusClause = query.status && query.status.length > 0 ? ' AND s.status IN (:statuses)' : '';
    const replacements = { ownerId, ...(statusClause ? { statuses: [...query.status!] } : {}) };
    const direction = query.direction === 'asc' ? 'ASC' : 'DESC';
    const counted = await this.db.query<{ total: number | string }>(`SELECT COUNT(*) AS total FROM students s WHERE ${where}${statusClause}`, { replacements, type: QueryTypes.SELECT, transaction });
    const rows = await this.db.query<StudentRow>(`${SELECT} WHERE ${where}${statusClause} ORDER BY ${SORT_COLUMN[query.sort]} ${direction}, s.id ASC LIMIT :limit OFFSET :offset`, {
      replacements: { ...replacements, limit: query.page.pageSize, offset: (query.page.page - 1) * query.page.pageSize },
      type: QueryTypes.SELECT,
      transaction,
    });
    return { items: rows.map((r) => this.toStudent(r)), total: Number(counted[0]?.total ?? 0) };
  }

  private async find(sql: string, value: string, tx?: TransactionContext): Promise<Student[]> {
    const rows = await this.db.query<StudentRow>(sql, { replacements: { value }, type: QueryTypes.SELECT, transaction: sequelizeTransactionOf(tx) ?? null });
    return rows.map((r) => this.toStudent(r));
  }

  private toStudent(r: StudentRow): Student {
    return Student.rehydrate({
      id: r.id,
      schoolId: r.schoolId,
      organizationId: r.organizationId,
      parentId: r.parentId,
      fullName: r.fullName,
      nationalId: r.nationalId,
      joinDate: r.joinDate,
      status: r.status,
      createdBy: r.createdBy,
      createdAt: asDate(r.createdAt),
      updatedAt: asDate(r.updatedAt),
      version: Number(r.version),
    });
  }
}
