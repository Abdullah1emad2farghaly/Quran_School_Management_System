import { QueryTypes, UniqueConstraintError, type Sequelize } from 'sequelize';
import type { TransactionContext } from '../../../../../00-shared-kernel/public';
import { sequelizeTransactionOf } from '../../../../../02-database/public';
import type { TeacherListQuery, TeacherRepository } from '../../../../application/ports/teacher-repository';
import { Teacher } from '../../../../domain/entities/teacher';
import { teacherError } from '../../../../domain/errors/teacher-errors';

type Queryable = Pick<Sequelize, 'query'>;

interface TeacherRow {
  id: string;
  userId: string;
  organizationId: string;
  createdBy: string;
  createdAt: Date | string;
  updatedAt: Date | string;
  version: number | string;
}

const SELECT = `
  SELECT p.id, p.user_id AS userId, p.organization_id AS organizationId, p.created_by AS createdBy,
         p.created_at AS createdAt, p.updated_at AS updatedAt, p.version
    FROM teachers p`;
const SORT_COLUMN = { createdAt: 'p.created_at' } as const;

const asDate = (value: Date | string): Date => (value instanceof Date ? value : new Date(value));

export class SequelizeTeacherRepository implements TeacherRepository {
  constructor(private readonly db: Queryable) {}

  async insert(teacher: Teacher, tx: TransactionContext): Promise<void> {
    const s = teacher.snapshot;
    try {
      await this.db.query(
        `INSERT INTO teachers (id, user_id, organization_id, created_by, version, created_at, updated_at)
         VALUES (:id, :userId, :organizationId, :createdBy, 1, :createdAt, :updatedAt)`,
        { replacements: { ...s }, transaction: sequelizeTransactionOf(tx) ?? null },
      );
    } catch (error) {
      // The unique index on user_id is the final guard: a concurrent registration of the same account already created the Teacher.
      if (error instanceof UniqueConstraintError) throw teacherError('TEACHER_CONCURRENT_MODIFICATION');
      throw error;
    }
  }

  async findById(id: string, tx?: TransactionContext): Promise<Teacher | undefined> {
    return (await this.find(`${SELECT} WHERE p.id = :value`, id, tx))[0];
  }
  async findByUserId(userId: string, tx?: TransactionContext): Promise<Teacher | undefined> {
    return (await this.find(`${SELECT} WHERE p.user_id = :value`, userId, tx))[0];
  }
  async lockByUserId(userId: string, tx: TransactionContext): Promise<Teacher | undefined> {
    return (await this.find(`${SELECT} WHERE p.user_id = :value FOR UPDATE`, userId, tx))[0];
  }
  async lockById(id: string, tx: TransactionContext): Promise<Teacher | undefined> {
    return (await this.find(`${SELECT} WHERE p.id = :value FOR UPDATE`, id, tx))[0];
  }

  async listBySchool(query: TeacherListQuery, tx?: TransactionContext): Promise<{ items: Teacher[]; total: number }> {
    const transaction = sequelizeTransactionOf(tx) ?? null;
    const join = 'JOIN teacher_schools ps ON ps.teacher_id = p.id AND ps.school_id = :schoolId AND ps.active = 1';
    const direction = query.direction === 'asc' ? 'ASC' : 'DESC';
    const counted = await this.db.query<{ total: number | string }>(`SELECT COUNT(*) AS total FROM teachers p ${join}`, {
      replacements: { schoolId: query.schoolId },
      type: QueryTypes.SELECT,
      transaction,
    });
    const rows = await this.db.query<TeacherRow>(`${SELECT} ${join} ORDER BY ${SORT_COLUMN[query.sort]} ${direction}, p.id ASC LIMIT :limit OFFSET :offset`, {
      replacements: { schoolId: query.schoolId, limit: query.page.pageSize, offset: (query.page.page - 1) * query.page.pageSize },
      type: QueryTypes.SELECT,
      transaction,
    });
    return { items: rows.map((r) => this.toTeacher(r)), total: Number(counted[0]?.total ?? 0) };
  }

  private async find(sql: string, value: string, tx?: TransactionContext): Promise<Teacher[]> {
    const rows = await this.db.query<TeacherRow>(sql, { replacements: { value }, type: QueryTypes.SELECT, transaction: sequelizeTransactionOf(tx) ?? null });
    return rows.map((r) => this.toTeacher(r));
  }

  private toTeacher(r: TeacherRow): Teacher {
    return Teacher.rehydrate({
      id: r.id,
      userId: r.userId,
      organizationId: r.organizationId,
      createdBy: r.createdBy,
      createdAt: asDate(r.createdAt),
      updatedAt: asDate(r.updatedAt),
      version: Number(r.version),
    });
  }
}
