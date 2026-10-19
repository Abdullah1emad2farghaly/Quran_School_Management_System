import { QueryTypes, UniqueConstraintError, type Sequelize } from 'sequelize';
import type { TransactionContext } from '../../../../../00-shared-kernel/public';
import { sequelizeTransactionOf } from '../../../../../02-database/public';
import type { ParentAddressEntry, ParentListQuery, ParentRepository } from '../../../../application/ports/parent-repository';
import { Parent } from '../../../../domain/entities/parent';
import { parentError } from '../../../../domain/errors/parent-errors';

type Queryable = Pick<Sequelize, 'query'>;

interface ParentRow {
  id: string;
  userId: string;
  organizationId: string;
  createdBy: string;
  createdAt: Date | string;
  updatedAt: Date | string;
  version: number | string;
}
interface AddressRow {
  id: string;
  parentId: string;
  governorateId: string;
  governorateName: string;
  centerName: string | null;
  villageName: string | null;
  createdBy: string;
  createdAt: Date | string;
  endedAt: Date | string | null;
}

const SELECT = `
  SELECT p.id, p.user_id AS userId, p.organization_id AS organizationId, p.created_by AS createdBy,
         p.created_at AS createdAt, p.updated_at AS updatedAt, p.version
    FROM parents p`;
const SELECT_ADDRESS = `
  SELECT id, parent_id AS parentId, governorate_id AS governorateId, governorate_name AS governorateName, center_name AS centerName,
         village_name AS villageName, created_by AS createdBy, created_at AS createdAt, ended_at AS endedAt
    FROM parent_addresses`;
const SORT_COLUMN = { createdAt: 'p.created_at' } as const;

const asDate = (value: Date | string): Date => (value instanceof Date ? value : new Date(value));

export class SequelizeParentRepository implements ParentRepository {
  constructor(private readonly db: Queryable) {}

  async insert(parent: Parent, tx: TransactionContext): Promise<void> {
    const s = parent.snapshot;
    try {
      await this.db.query(
        `INSERT INTO parents (id, user_id, organization_id, created_by, version, created_at, updated_at)
         VALUES (:id, :userId, :organizationId, :createdBy, 1, :createdAt, :updatedAt)`,
        { replacements: { ...s }, transaction: sequelizeTransactionOf(tx) ?? null },
      );
    } catch (error) {
      // The unique index on user_id is the final guard: a concurrent registration of the same account already created the Parent.
      if (error instanceof UniqueConstraintError) throw parentError('PARENT_CONCURRENT_MODIFICATION');
      throw error;
    }
  }

  async update(parent: Parent, tx: TransactionContext): Promise<void> {
    const s = parent.snapshot;
    const [, affected] = await this.db.query(
      'UPDATE parents SET updated_at = :updatedAt, version = version + 1 WHERE id = :id AND version = :version',
      { replacements: { id: s.id, version: s.version, updatedAt: s.updatedAt }, type: QueryTypes.UPDATE, transaction: sequelizeTransactionOf(tx) ?? null },
    );
    if (Number(affected) !== 1) throw parentError('PARENT_CONCURRENT_MODIFICATION');
  }

  async findById(id: string, tx?: TransactionContext): Promise<Parent | undefined> {
    return (await this.find(`${SELECT} WHERE p.id = :value`, id, tx))[0];
  }
  async findByUserId(userId: string, tx?: TransactionContext): Promise<Parent | undefined> {
    return (await this.find(`${SELECT} WHERE p.user_id = :value`, userId, tx))[0];
  }
  async lockByUserId(userId: string, tx: TransactionContext): Promise<Parent | undefined> {
    return (await this.find(`${SELECT} WHERE p.user_id = :value FOR UPDATE`, userId, tx))[0];
  }
  async lockById(id: string, tx: TransactionContext): Promise<Parent | undefined> {
    return (await this.find(`${SELECT} WHERE p.id = :value FOR UPDATE`, id, tx))[0];
  }

  async listBySchool(query: ParentListQuery, tx?: TransactionContext): Promise<{ items: Parent[]; total: number }> {
    const transaction = sequelizeTransactionOf(tx) ?? null;
    const join = 'JOIN parent_schools ps ON ps.parent_id = p.id AND ps.school_id = :schoolId AND ps.active = 1';
    const direction = query.direction === 'asc' ? 'ASC' : 'DESC';
    const counted = await this.db.query<{ total: number | string }>(`SELECT COUNT(*) AS total FROM parents p ${join}`, {
      replacements: { schoolId: query.schoolId },
      type: QueryTypes.SELECT,
      transaction,
    });
    const rows = await this.db.query<ParentRow>(`${SELECT} ${join} ORDER BY ${SORT_COLUMN[query.sort]} ${direction}, p.id ASC LIMIT :limit OFFSET :offset`, {
      replacements: { schoolId: query.schoolId, limit: query.page.pageSize, offset: (query.page.page - 1) * query.page.pageSize },
      type: QueryTypes.SELECT,
      transaction,
    });
    return { items: rows.map((r) => this.toParent(r)), total: Number(counted[0]?.total ?? 0) };
  }

  async insertAddress(e: ParentAddressEntry, tx: TransactionContext): Promise<void> {
    await this.db.query(
      `INSERT INTO parent_addresses (id, parent_id, governorate_id, governorate_name, center_name, village_name, created_by, created_at, ended_at, active)
       VALUES (:id, :parentId, :governorateId, :governorateName, :centerName, :villageName, :createdBy, :createdAt, NULL, 1)`,
      { replacements: { ...e }, transaction: sequelizeTransactionOf(tx) ?? null },
    );
  }

  async replaceCurrentAddress(e: ParentAddressEntry, tx: TransactionContext): Promise<void> {
    await this.db.query('UPDATE parent_addresses SET active = NULL, ended_at = :at WHERE parent_id = :parentId AND active = 1', {
      replacements: { parentId: e.parentId, at: e.createdAt },
      type: QueryTypes.UPDATE,
      transaction: sequelizeTransactionOf(tx) ?? null,
    });
    await this.insertAddress(e, tx);
  }

  async findCurrentAddress(parentId: string, tx?: TransactionContext): Promise<ParentAddressEntry | undefined> {
    const rows = await this.db.query<AddressRow>(`${SELECT_ADDRESS} WHERE parent_id = :parentId AND active = 1`, {
      replacements: { parentId },
      type: QueryTypes.SELECT,
      transaction: sequelizeTransactionOf(tx) ?? null,
    });
    return rows[0] ? this.toAddress(rows[0]) : undefined;
  }

  async findCurrentAddresses(parentIds: readonly string[], tx?: TransactionContext): Promise<Map<string, ParentAddressEntry>> {
    const result = new Map<string, ParentAddressEntry>();
    if (parentIds.length === 0) return result;
    const rows = await this.db.query<AddressRow>(`${SELECT_ADDRESS} WHERE parent_id IN (:parentIds) AND active = 1`, {
      replacements: { parentIds: [...parentIds] },
      type: QueryTypes.SELECT,
      transaction: sequelizeTransactionOf(tx) ?? null,
    });
    for (const r of rows) result.set(r.parentId, this.toAddress(r));
    return result;
  }

  async listAddressHistory(parentId: string, tx?: TransactionContext): Promise<ParentAddressEntry[]> {
    const rows = await this.db.query<AddressRow>(`${SELECT_ADDRESS} WHERE parent_id = :parentId ORDER BY created_at, id`, {
      replacements: { parentId },
      type: QueryTypes.SELECT,
      transaction: sequelizeTransactionOf(tx) ?? null,
    });
    return rows.map((r) => this.toAddress(r));
  }

  private async find(sql: string, value: string, tx?: TransactionContext): Promise<Parent[]> {
    const rows = await this.db.query<ParentRow>(sql, { replacements: { value }, type: QueryTypes.SELECT, transaction: sequelizeTransactionOf(tx) ?? null });
    return rows.map((r) => this.toParent(r));
  }

  private toParent(r: ParentRow): Parent {
    return Parent.rehydrate({
      id: r.id,
      userId: r.userId,
      organizationId: r.organizationId,
      createdBy: r.createdBy,
      createdAt: asDate(r.createdAt),
      updatedAt: asDate(r.updatedAt),
      version: Number(r.version),
    });
  }

  private toAddress(r: AddressRow): ParentAddressEntry {
    return {
      id: r.id,
      parentId: r.parentId,
      governorateId: r.governorateId,
      governorateName: r.governorateName,
      centerName: r.centerName,
      villageName: r.villageName,
      createdBy: r.createdBy,
      createdAt: asDate(r.createdAt),
      endedAt: r.endedAt === null ? null : asDate(r.endedAt),
    };
  }
}
