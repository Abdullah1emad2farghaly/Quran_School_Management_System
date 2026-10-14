import { QueryTypes, UniqueConstraintError, type Sequelize } from 'sequelize';
import type { TransactionContext } from '../../../../../00-shared-kernel/public';
import { sequelizeTransactionOf } from '../../../../../02-database/public';
import type { OrganizationAdminRepository } from '../../../../application/ports/organization-admin-repository';
import { OrganizationAdminAssignment } from '../../../../domain/entities/organization-admin-assignment';
import { organizationError } from '../../../../domain/errors/organization-errors';

type Queryable = Pick<Sequelize, 'query'>;

interface Row {
  id: string;
  organizationId: string;
  userId: string;
  name: string | null;
  assignedAt: Date | string;
  assignedBy: string | null;
  revokedAt: Date | string | null;
  revokedBy: string | null;
  version: number | string;
}

const asDate = (value: Date | string): Date => (value instanceof Date ? value : new Date(value));

export class SequelizeOrganizationAdminRepository implements OrganizationAdminRepository {
  constructor(private readonly db: Queryable) {}

  async insert(a: OrganizationAdminAssignment, tx: TransactionContext): Promise<void> {
    const s = a.snapshot;
    try {
      await this.db.query(
        `INSERT INTO organization_admins
           (id, organization_id, user_id, name, assigned_at, assigned_by, revoked_at, revoked_by, active, version, created_at, updated_at)
         VALUES (:id, :organizationId, :userId, :name, :assignedAt, :assignedBy, NULL, NULL, 1, 1, :assignedAt, :assignedAt)`,
        { replacements: { id: s.id, organizationId: s.organizationId, userId: s.userId, name: s.name, assignedAt: s.assignedAt, assignedBy: s.assignedBy }, transaction: sequelizeTransactionOf(tx) ?? null },
      );
    } catch (error) {
      if (error instanceof UniqueConstraintError) throw organizationError('ORGANIZATION_ALREADY_EXISTS');
      throw error;
    }
  }

  async findActive(userId: string, organizationId: string, tx?: TransactionContext): Promise<OrganizationAdminAssignment | undefined> {
    const rows = await this.db.query<Row>(
      `SELECT id, organization_id AS organizationId, user_id AS userId, name, assigned_at AS assignedAt, assigned_by AS assignedBy,
              revoked_at AS revokedAt, revoked_by AS revokedBy, version
         FROM organization_admins WHERE user_id = :userId AND organization_id = :organizationId AND active = 1`,
      { replacements: { userId, organizationId }, type: QueryTypes.SELECT, transaction: sequelizeTransactionOf(tx) ?? null },
    );
    const r = rows[0];
    if (!r) return undefined;
    return OrganizationAdminAssignment.rehydrate({
      id: r.id,
      organizationId: r.organizationId,
      userId: r.userId,
      name: r.name,
      assignedAt: asDate(r.assignedAt),
      assignedBy: r.assignedBy,
      revokedAt: r.revokedAt === null ? null : asDate(r.revokedAt),
      revokedBy: r.revokedBy,
      version: Number(r.version),
    });
  }

  async listActiveOrganizationIdsByUser(userId: string, tx?: TransactionContext): Promise<string[]> {
    const rows = await this.db.query<{ organizationId: string }>(
      'SELECT organization_id AS organizationId FROM organization_admins WHERE user_id = :userId AND active = 1 ORDER BY assigned_at, id',
      { replacements: { userId }, type: QueryTypes.SELECT, transaction: sequelizeTransactionOf(tx) ?? null },
    );
    return rows.map((r) => r.organizationId);
  }
}
