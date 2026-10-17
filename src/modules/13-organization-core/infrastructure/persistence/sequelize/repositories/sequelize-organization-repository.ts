import { ForeignKeyConstraintError, QueryTypes, UniqueConstraintError, type Sequelize } from 'sequelize';
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
  countryId: string | null;
  governorateId: string | null;
  centerName: string | null;
  villageName: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

const SELECT = `SELECT id, code, name, status, country_id AS countryId, governorate_id AS governorateId, center_name AS centerName, village_name AS villageName, created_at AS createdAt, updated_at AS updatedAt FROM organizations`;
const asDate = (value: Date | string): Date => (value instanceof Date ? value : new Date(value));

export class SequelizeOrganizationRepository implements OrganizationRepository {
  constructor(private readonly db: Queryable) {}

  async insert(organization: Organization, tx: TransactionContext): Promise<void> {
    try {
      await this.db.query(
        `INSERT INTO organizations (id, code, name, status, country_id, governorate_id, center_name, village_name, created_at, updated_at)
         VALUES (:id, :code, :name, :status, :countryId, :governorateId, :centerName, :villageName, :createdAt, :updatedAt)`,
        {
          replacements: {
            id: organization.id,
            code: organization.code,
            name: organization.name,
            status: organization.status,
            countryId: organization.countryId,
            governorateId: organization.governorateId,
            centerName: organization.centerName,
            villageName: organization.villageName,
            createdAt: organization.createdAt,
            updatedAt: organization.updatedAt,
          },
          transaction: sequelizeTransactionOf(tx) ?? null,
        },
      );
    } catch (error) {
      // The unique indexes are the final guard against concurrent creation: the NAME is unique across the whole system.
      if (error instanceof UniqueConstraintError) {
        const detail = String((error.parent as { sqlMessage?: string } | undefined)?.sqlMessage ?? error.message);
        throw organizationError(/uq_organizations_name/.test(detail) ? 'ORGANIZATION_NAME_ALREADY_EXISTS' : 'ORGANIZATION_ALREADY_EXISTS');
      }
      // The foreign keys are the final guard for country and address (they must be existing geography rows).
      if (error instanceof ForeignKeyConstraintError) throw organizationError('INVALID_ORGANIZATION_ADDRESS');
      throw error;
    }
  }

  findMain(tx?: TransactionContext): Promise<Organization | undefined> {
    return this.findOne(`${SELECT} ORDER BY created_at ASC, id ASC LIMIT 1`, {}, tx);
  }

  findMainForUpdate(tx: TransactionContext): Promise<Organization | undefined> {
    return this.findOne(`${SELECT} ORDER BY created_at ASC, id ASC LIMIT 1 FOR UPDATE`, {}, tx);
  }

  findById(id: string, tx?: TransactionContext): Promise<Organization | undefined> {
    return this.findOne(`${SELECT} WHERE id = :id`, { id }, tx);
  }

  async assignCountryIfUnset(organizationId: string, countryId: string, updatedAt: Date, tx: TransactionContext): Promise<boolean> {
    try {
      const [, affected] = await this.db.query(
        'UPDATE organizations SET country_id = :countryId, updated_at = :updatedAt WHERE id = :id AND country_id IS NULL',
        { replacements: { id: organizationId, countryId, updatedAt }, type: QueryTypes.UPDATE, transaction: sequelizeTransactionOf(tx) ?? null },
      );
      return Number(affected) === 1;
    } catch (error) {
      // The foreign key to countries.id is the final guard: the country must exist (and must be a primary key, not a code).
      if (error instanceof ForeignKeyConstraintError) throw organizationError('ORGANIZATION_COUNTRY_INVALID');
      throw error;
    }
  }

  /**
   * Allocates the next code number from the single locked `organization_code_sequence` row: concurrent registrations
   * queue on the row lock (no duplicate codes), a rolled-back registration leaves no gap. Run inside the creating transaction.
   */
  async nextCodeSequence(tx?: TransactionContext): Promise<number> {
    const transaction = sequelizeTransactionOf(tx) ?? null;
    const rows = await this.db.query<{ lastValue: number | string }>(
      "SELECT last_value AS lastValue FROM organization_code_sequence WHERE name = 'organization' FOR UPDATE",
      { type: QueryTypes.SELECT, transaction },
    );
    if (rows.length === 0) throw new Error('organization_code_sequence is not initialised; run npm run db:migrate');
    const next = Number(rows[0]!.lastValue) + 1;
    await this.db.query("UPDATE organization_code_sequence SET last_value = :next, updated_at = UTC_TIMESTAMP(3) WHERE name = 'organization'", {
      replacements: { next },
      type: QueryTypes.UPDATE,
      transaction,
    });
    return next;
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
      countryId: row.countryId ?? null,
      governorateId: row.governorateId ?? null,
      centerName: row.centerName ?? null,
      villageName: row.villageName ?? null,
      createdAt: asDate(row.createdAt),
      updatedAt: asDate(row.updatedAt),
    });
  }
}
