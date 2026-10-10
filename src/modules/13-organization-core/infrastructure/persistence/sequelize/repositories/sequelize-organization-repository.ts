import { QueryTypes, UniqueConstraintError, type Sequelize } from 'sequelize';
import type { TransactionContext } from '../../../../../00-shared-kernel/public';
import { sequelizeTransactionOf } from '../../../../../02-database/public';
import type { OrganizationRepository } from '../../../../application/ports/organization-repository';
import { Organization } from '../../../../domain/entities/organization';
import { organizationError } from '../../../../domain/errors/organization-errors';
import type { OrganizationStatus } from '../../../../domain/value-objects/organization-status';

type Queryable = Pick<Sequelize, 'query'>;

interface OrganizationRow {
  id: string;
  code: string;
  name: string;
  status: OrganizationStatus;
  createdAt: Date | string;
  updatedAt: Date | string;
}

const SELECT = `SELECT id, code, name, status, created_at AS createdAt, updated_at AS updatedAt FROM organizations`;
const asDate = (value: Date | string): Date => (value instanceof Date ? value : new Date(value));

export class SequelizeOrganizationRepository implements OrganizationRepository {
  constructor(private readonly db: Queryable) {}

  async insert(organization: Organization, tx: TransactionContext): Promise<void> {
    try {
      await this.db.query(
        `INSERT INTO organizations (id, code, name, status, created_at, updated_at)
         VALUES (:id, :code, :name, :status, :createdAt, :updatedAt)`,
        {
          replacements: {
            id: organization.id,
            code: organization.code,
            name: organization.name,
            status: organization.status,
            createdAt: organization.createdAt,
            updatedAt: organization.updatedAt,
          },
          transaction: sequelizeTransactionOf(tx) ?? null,
        },
      );
    } catch (error) {
      // The unique indexes (V1 single-organization guard, code) are the final guard against concurrent creation.
      if (error instanceof UniqueConstraintError) throw organizationError('ORGANIZATION_ALREADY_EXISTS');
      throw error;
    }
  }

  findMain(tx?: TransactionContext): Promise<Organization | undefined> {
    return this.findOne(`${SELECT} ORDER BY created_at ASC, id ASC LIMIT 1`, {}, tx);
  }

  findById(id: string, tx?: TransactionContext): Promise<Organization | undefined> {
    return this.findOne(`${SELECT} WHERE id = :id`, { id }, tx);
  }

  async nextCodeSequence(tx?: TransactionContext): Promise<number> {
    const rows = await this.db.query<{ next: number | string }>(
      'SELECT COALESCE(MAX(CAST(SUBSTRING(code, 5) AS UNSIGNED)), 0) + 1 AS next FROM organizations',
      { type: QueryTypes.SELECT, transaction: sequelizeTransactionOf(tx) ?? null },
    );
    return Number(rows[0]?.next ?? 1);
  }

  private async findOne(sql: string, replacements: Record<string, string>, tx?: TransactionContext): Promise<Organization | undefined> {
    const rows = await this.db.query<OrganizationRow>(sql, {
      replacements,
      type: QueryTypes.SELECT,
      transaction: sequelizeTransactionOf(tx) ?? null,
    });
    const row = rows[0];
    if (!row) return undefined;
    return Organization.rehydrate({
      id: row.id,
      code: row.code,
      name: row.name,
      status: row.status,
      createdAt: asDate(row.createdAt),
      updatedAt: asDate(row.updatedAt),
    });
  }
}
