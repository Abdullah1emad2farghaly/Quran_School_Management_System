import { QueryTypes, UniqueConstraintError, type Sequelize } from 'sequelize';
import type { TransactionContext } from '../../../../../00-shared-kernel/public';
import { sequelizeTransactionOf } from '../../../../../02-database/public';
import type { RoleAssignmentRepository } from '../../../../application/ports/role-assignment-repository';
import { RoleAssignment } from '../../../../domain/entities/role-assignment';
import { roleError } from '../../../../domain/errors/role-errors';
import type { RoleCode } from '../../../../domain/value-objects/role-code';

type Queryable = Pick<Sequelize, 'query'>;

interface Row {
  id: string;
  userId: string;
  roleCode: RoleCode;
  assignedAt: Date | string;
  assignedBy: string | null;
  revokedAt: Date | string | null;
  revokedBy: string | null;
  version: number | string;
}

const SELECT = `
  SELECT id, user_id AS userId, role_code AS roleCode, assigned_at AS assignedAt, assigned_by AS assignedBy,
         revoked_at AS revokedAt, revoked_by AS revokedBy, version
    FROM user_roles`;

const asDate = (value: Date | string): Date => (value instanceof Date ? value : new Date(value));

export class SequelizeRoleAssignmentRepository implements RoleAssignmentRepository {
  constructor(private readonly db: Queryable) {}

  async insert(a: RoleAssignment, tx: TransactionContext): Promise<void> {
    try {
      await this.db.query(
        `INSERT INTO user_roles
           (id, user_id, role_code, assigned_at, assigned_by, revoked_at, revoked_by, active, version, created_at, updated_at)
         VALUES
           (:id, :userId, :roleCode, :assignedAt, :assignedBy, NULL, NULL, 1, 1, :assignedAt, :assignedAt)`,
        {
          replacements: { id: a.id, userId: a.userId, roleCode: a.roleCode, assignedAt: a.assignedAt, assignedBy: a.assignedBy },
          transaction: sequelizeTransactionOf(tx) ?? null,
        },
      );
    } catch (error) {
      // The unique (user_id, role_code, active) index is the final guard against concurrent duplicate assignment.
      if (error instanceof UniqueConstraintError) throw roleError('ROLE_ALREADY_ASSIGNED');
      throw error;
    }
  }

  async update(a: RoleAssignment, tx: TransactionContext): Promise<void> {
    const revokedAt = a.revokedAt;
    const [, affectedRows] = await this.db.query(
      `UPDATE user_roles
          SET revoked_at = :revokedAt, revoked_by = :revokedBy,
              active = IF(:revokedAt IS NULL, 1, NULL), updated_at = :updatedAt, version = version + 1
        WHERE id = :id AND version = :version`,
      {
        replacements: {
          id: a.id,
          version: a.version,
          revokedAt,
          revokedBy: a.revokedBy,
          updatedAt: revokedAt ?? a.assignedAt,
        },
        type: QueryTypes.UPDATE,
        transaction: sequelizeTransactionOf(tx) ?? null,
      },
    );
    if (Number(affectedRows) !== 1) throw roleError('ROLE_CONCURRENT_MODIFICATION');
  }

  lockAllByUser(userId: string, tx: TransactionContext): Promise<RoleAssignment[]> {
    return this.find(`${SELECT} WHERE user_id = :userId ORDER BY assigned_at, id FOR UPDATE`, userId, tx);
  }

  findActiveByUser(userId: string, tx?: TransactionContext): Promise<RoleAssignment[]> {
    return this.find(`${SELECT} WHERE user_id = :userId AND active = 1 ORDER BY assigned_at, id`, userId, tx);
  }

  async countActiveByRole(roleCode: RoleCode, tx?: TransactionContext): Promise<number> {
    const rows = await this.db.query<{ total: number | string }>(
      'SELECT COUNT(*) AS total FROM user_roles WHERE role_code = :roleCode AND active = 1',
      { replacements: { roleCode }, type: QueryTypes.SELECT, transaction: sequelizeTransactionOf(tx) ?? null },
    );
    return Number(rows[0]?.total ?? 0);
  }

  findHistoryByUser(userId: string, tx?: TransactionContext): Promise<RoleAssignment[]> {
    return this.find(`${SELECT} WHERE user_id = :userId ORDER BY assigned_at, id`, userId, tx);
  }

  private async find(sql: string, userId: string, tx?: TransactionContext): Promise<RoleAssignment[]> {
    const rows = await this.db.query<Row>(sql, {
      replacements: { userId },
      type: QueryTypes.SELECT,
      transaction: sequelizeTransactionOf(tx) ?? null,
    });
    return rows.map((r) =>
      RoleAssignment.rehydrate({
        id: r.id,
        userId: r.userId,
        roleCode: r.roleCode,
        assignedAt: asDate(r.assignedAt),
        assignedBy: r.assignedBy,
        revokedAt: r.revokedAt === null ? null : asDate(r.revokedAt),
        revokedBy: r.revokedBy,
        version: Number(r.version),
      }),
    );
  }
}
