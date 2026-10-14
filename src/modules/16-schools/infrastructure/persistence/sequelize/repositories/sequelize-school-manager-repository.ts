import { QueryTypes, UniqueConstraintError, type Sequelize } from 'sequelize';
import type { TransactionContext } from '../../../../../00-shared-kernel/public';
import { sequelizeTransactionOf } from '../../../../../02-database/public';
import type { SchoolManagerRepository } from '../../../../application/ports/school-manager-repository';
import { SchoolManagerAssignment, type SchoolManagerSource } from '../../../../domain/entities/school-manager-assignment';
import { schoolError } from '../../../../domain/errors/school-errors';

type Queryable = Pick<Sequelize, 'query'>;

interface Row {
  id: string;
  schoolId: string;
  userId: string;
  source: SchoolManagerSource;
  assignedAt: Date | string;
  assignedBy: string;
  revokedAt: Date | string | null;
  revokedBy: string | null;
  version: number | string;
}

const SELECT = `
  SELECT id, school_id AS schoolId, user_id AS userId, source, assigned_at AS assignedAt, assigned_by AS assignedBy,
         revoked_at AS revokedAt, revoked_by AS revokedBy, version
    FROM school_managers`;

const asDate = (value: Date | string): Date => (value instanceof Date ? value : new Date(value));

export class SequelizeSchoolManagerRepository implements SchoolManagerRepository {
  constructor(private readonly db: Queryable) {}

  async insert(a: SchoolManagerAssignment, tx: TransactionContext): Promise<void> {
    const s = a.snapshot;
    try {
      await this.db.query(
        `INSERT INTO school_managers
           (id, school_id, user_id, source, assigned_at, assigned_by, revoked_at, revoked_by, active, version, created_at, updated_at)
         VALUES (:id, :schoolId, :userId, :source, :assignedAt, :assignedBy, NULL, NULL, 1, 1, :assignedAt, :assignedAt)`,
        {
          replacements: { id: s.id, schoolId: s.schoolId, userId: s.userId, source: s.source, assignedAt: s.assignedAt, assignedBy: s.assignedBy },
          transaction: sequelizeTransactionOf(tx) ?? null,
        },
      );
    } catch (error) {
      // The unique (school_id, active) index is the final guard: at most one active manager per school.
      if (error instanceof UniqueConstraintError) throw schoolError('SCHOOL_ALREADY_HAS_MANAGER');
      throw error;
    }
  }

  async update(a: SchoolManagerAssignment, tx: TransactionContext): Promise<void> {
    const s = a.snapshot;
    const [, affected] = await this.db.query(
      `UPDATE school_managers
          SET revoked_at = :revokedAt, revoked_by = :revokedBy,
              active = IF(:revokedAt IS NULL, 1, NULL), updated_at = :updatedAt, version = version + 1
        WHERE id = :id AND version = :version`,
      {
        replacements: { id: s.id, version: s.version, revokedAt: s.revokedAt, revokedBy: s.revokedBy, updatedAt: s.revokedAt ?? s.assignedAt },
        type: QueryTypes.UPDATE,
        transaction: sequelizeTransactionOf(tx) ?? null,
      },
    );
    if (Number(affected) !== 1) throw schoolError('SCHOOL_CONCURRENT_MODIFICATION');
  }

  async lockActiveBySchool(schoolId: string, tx: TransactionContext): Promise<SchoolManagerAssignment | undefined> {
    return (await this.find(`${SELECT} WHERE school_id = :value AND active = 1 FOR UPDATE`, schoolId, tx))[0];
  }

  async findActiveBySchool(schoolId: string, tx?: TransactionContext): Promise<SchoolManagerAssignment | undefined> {
    return (await this.find(`${SELECT} WHERE school_id = :value AND active = 1`, schoolId, tx))[0];
  }

  findHistoryBySchool(schoolId: string, tx?: TransactionContext): Promise<SchoolManagerAssignment[]> {
    return this.find(`${SELECT} WHERE school_id = :value ORDER BY assigned_at, id`, schoolId, tx);
  }

  async isActiveManager(userId: string, schoolId: string, tx?: TransactionContext): Promise<boolean> {
    const rows = await this.db.query(
      'SELECT 1 AS present FROM school_managers WHERE user_id = :userId AND school_id = :schoolId AND active = 1 LIMIT 1',
      { replacements: { userId, schoolId }, type: QueryTypes.SELECT, transaction: sequelizeTransactionOf(tx) ?? null },
    );
    return rows.length > 0;
  }

  async listActiveSchoolIdsByUser(userId: string, tx?: TransactionContext): Promise<string[]> {
    const rows = await this.db.query<{ schoolId: string }>(
      'SELECT school_id AS schoolId FROM school_managers WHERE user_id = :userId AND active = 1 ORDER BY assigned_at, id',
      { replacements: { userId }, type: QueryTypes.SELECT, transaction: sequelizeTransactionOf(tx) ?? null },
    );
    return rows.map((r) => r.schoolId);
  }

  private async find(sql: string, value: string, tx?: TransactionContext): Promise<SchoolManagerAssignment[]> {
    const rows = await this.db.query<Row>(sql, { replacements: { value }, type: QueryTypes.SELECT, transaction: sequelizeTransactionOf(tx) ?? null });
    return rows.map((r) =>
      SchoolManagerAssignment.rehydrate({
        id: r.id,
        schoolId: r.schoolId,
        userId: r.userId,
        source: r.source,
        assignedAt: asDate(r.assignedAt),
        assignedBy: r.assignedBy,
        revokedAt: r.revokedAt === null ? null : asDate(r.revokedAt),
        revokedBy: r.revokedBy,
        version: Number(r.version),
      }),
    );
  }
}
