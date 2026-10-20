import { QueryTypes, UniqueConstraintError, type Sequelize } from 'sequelize';
import type { TransactionContext } from '../../../../../00-shared-kernel/public';
import { sequelizeTransactionOf } from '../../../../../02-database/public';
import type { TeacherSchoolLinkRepository } from '../../../../application/ports/teacher-school-link-repository';
import { TeacherSchoolLink } from '../../../../domain/entities/teacher-school-link';
import { teacherError } from '../../../../domain/errors/teacher-errors';

type Queryable = Pick<Sequelize, 'query'>;

interface Row {
  id: string;
  teacherId: string;
  userId: string;
  organizationId: string;
  schoolId: string;
  linkedAt: Date | string;
  linkedBy: string;
  unlinkedAt: Date | string | null;
  unlinkedBy: string | null;
  version: number | string;
}

// user_id / organization_id come from the teacher (the link row does not duplicate them).
const SELECT = `
  SELECT ps.id, ps.teacher_id AS teacherId, p.user_id AS userId, p.organization_id AS organizationId, ps.school_id AS schoolId,
         ps.linked_at AS linkedAt, ps.linked_by AS linkedBy, ps.unlinked_at AS unlinkedAt, ps.unlinked_by AS unlinkedBy, ps.version
    FROM teacher_schools ps JOIN teachers p ON p.id = ps.teacher_id`;

const asDate = (value: Date | string): Date => (value instanceof Date ? value : new Date(value));

export class SequelizeTeacherSchoolLinkRepository implements TeacherSchoolLinkRepository {
  constructor(private readonly db: Queryable) {}

  async insert(link: TeacherSchoolLink, tx: TransactionContext): Promise<void> {
    const s = link.snapshot;
    try {
      await this.db.query(
        `INSERT INTO teacher_schools (id, teacher_id, school_id, linked_at, linked_by, unlinked_at, unlinked_by, active, version, created_at, updated_at)
         VALUES (:id, :teacherId, :schoolId, :linkedAt, :linkedBy, NULL, NULL, 1, 1, :linkedAt, :linkedAt)`,
        { replacements: { id: s.id, teacherId: s.teacherId, schoolId: s.schoolId, linkedAt: s.linkedAt, linkedBy: s.linkedBy }, transaction: sequelizeTransactionOf(tx) ?? null },
      );
    } catch (error) {
      // The unique (teacher_id, school_id, active) index is the final guard: at most one active link per teacher and school.
      if (error instanceof UniqueConstraintError) throw teacherError('TEACHER_ALREADY_LINKED_TO_SCHOOL');
      throw error;
    }
  }

  async update(link: TeacherSchoolLink, tx: TransactionContext): Promise<void> {
    const s = link.snapshot;
    const [, affected] = await this.db.query(
      `UPDATE teacher_schools
          SET unlinked_at = :unlinkedAt, unlinked_by = :unlinkedBy, active = IF(:unlinkedAt IS NULL, 1, NULL),
              updated_at = :updatedAt, version = version + 1
        WHERE id = :id AND version = :version`,
      {
        replacements: { id: s.id, version: s.version, unlinkedAt: s.unlinkedAt, unlinkedBy: s.unlinkedBy, updatedAt: s.unlinkedAt ?? s.linkedAt },
        type: QueryTypes.UPDATE,
        transaction: sequelizeTransactionOf(tx) ?? null,
      },
    );
    if (Number(affected) !== 1) throw teacherError('TEACHER_CONCURRENT_MODIFICATION');
  }

  async findActive(teacherId: string, schoolId: string, tx?: TransactionContext): Promise<TeacherSchoolLink | undefined> {
    return (await this.find(`${SELECT} WHERE ps.teacher_id = :teacherId AND ps.school_id = :schoolId AND ps.active = 1`, { teacherId, schoolId }, tx))[0];
  }
  async lockActive(teacherId: string, schoolId: string, tx: TransactionContext): Promise<TeacherSchoolLink | undefined> {
    return (await this.find(`${SELECT} WHERE ps.teacher_id = :teacherId AND ps.school_id = :schoolId AND ps.active = 1 FOR UPDATE`, { teacherId, schoolId }, tx))[0];
  }
  listActiveByTeacher(teacherId: string, tx?: TransactionContext): Promise<TeacherSchoolLink[]> {
    return this.find(`${SELECT} WHERE ps.teacher_id = :teacherId AND ps.active = 1 ORDER BY ps.linked_at, ps.id`, { teacherId }, tx);
  }
  async listActiveByTeachers(teacherIds: readonly string[], tx?: TransactionContext): Promise<Map<string, TeacherSchoolLink[]>> {
    const result = new Map<string, TeacherSchoolLink[]>();
    if (teacherIds.length === 0) return result;
    const links = await this.find(`${SELECT} WHERE ps.teacher_id IN (:teacherIds) AND ps.active = 1 ORDER BY ps.linked_at, ps.id`, { teacherIds: [...teacherIds] }, tx);
    for (const link of links) {
      const list = result.get(link.snapshot.teacherId) ?? [];
      list.push(link);
      result.set(link.snapshot.teacherId, list);
    }
    return result;
  }
  listHistoryByTeacher(teacherId: string, tx?: TransactionContext): Promise<TeacherSchoolLink[]> {
    return this.find(`${SELECT} WHERE ps.teacher_id = :teacherId ORDER BY ps.linked_at, ps.id`, { teacherId }, tx);
  }

  private async find(sql: string, replacements: Record<string, unknown>, tx?: TransactionContext): Promise<TeacherSchoolLink[]> {
    const rows = await this.db.query<Row>(sql, { replacements, type: QueryTypes.SELECT, transaction: sequelizeTransactionOf(tx) ?? null });
    return rows.map((r) =>
      TeacherSchoolLink.rehydrate({
        id: r.id,
        teacherId: r.teacherId,
        userId: r.userId,
        organizationId: r.organizationId,
        schoolId: r.schoolId,
        linkedAt: asDate(r.linkedAt),
        linkedBy: r.linkedBy,
        unlinkedAt: r.unlinkedAt === null ? null : asDate(r.unlinkedAt),
        unlinkedBy: r.unlinkedBy,
        version: Number(r.version),
      }),
    );
  }
}
