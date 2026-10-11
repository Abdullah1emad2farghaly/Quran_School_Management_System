import { ForeignKeyConstraintError, QueryTypes, UniqueConstraintError, type Sequelize } from 'sequelize';
import type { TransactionContext } from '../../../../../00-shared-kernel/public';
import { sequelizeTransactionOf } from '../../../../../02-database/public';
import type { GeographyRepository } from '../../../../application/ports/geography-repository';
import { GeographyNode } from '../../../../domain/entities/geography-node';
import { geographyError } from '../../../../domain/errors/geography-errors';
import type { CenterKind, GeographyLevel, GeographyStatus } from '../../../../domain/value-objects/geography-level';

type Queryable = Pick<Sequelize, 'query'>;

/** Fixed internal mapping (never user input): one table per level, referencing only its parent. */
const TABLE: Readonly<Record<GeographyLevel, { table: string; parent: string | null }>> = {
  COUNTRY: { table: 'countries', parent: null },
  GOVERNORATE: { table: 'governorates', parent: 'country_id' },
  CENTER: { table: 'centers', parent: 'governorate_id' },
  VILLAGE: { table: 'villages', parent: 'center_id' },
};

interface Row {
  id: string;
  code: string;
  name: string;
  status: GeographyStatus;
  parentId: string | null;
  kind: CenterKind | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

const asDate = (value: Date | string): Date => (value instanceof Date ? value : new Date(value));

function selectFor(level: GeographyLevel): string {
  const { table, parent } = TABLE[level];
  return `SELECT id, code, name, status, ${parent ?? 'NULL'} AS parentId, ${level === 'CENTER' ? 'kind' : 'NULL'} AS kind,
          created_at AS createdAt, updated_at AS updatedAt FROM ${table}`;
}

export class SequelizeGeographyRepository implements GeographyRepository {
  constructor(private readonly db: Queryable) {}

  async insert(node: GeographyNode, tx: TransactionContext): Promise<void> {
    const { table, parent } = TABLE[node.level];
    const columns = ['id', 'code', 'name', 'status', ...(parent ? [parent] : []), ...(node.level === 'CENTER' ? ['kind'] : []), 'created_at', 'updated_at'];
    const values = [':id', ':code', ':name', ':status', ...(parent ? [':parentId'] : []), ...(node.level === 'CENTER' ? [':kind'] : []), ':createdAt', ':updatedAt'];
    try {
      await this.db.query(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${values.join(', ')})`, {
        replacements: {
          id: node.id, code: node.code, name: node.name, status: node.status, parentId: node.parentId, kind: node.kind,
          createdAt: node.createdAt, updatedAt: node.updatedAt,
        },
        transaction: sequelizeTransactionOf(tx) ?? null,
      });
    } catch (error) {
      // The unique indexes and foreign keys are the final guard (the services also check first).
      if (error instanceof UniqueConstraintError) throw geographyError('GEOGRAPHY_NODE_ALREADY_EXISTS');
      if (error instanceof ForeignKeyConstraintError) throw geographyError('GEOGRAPHY_PARENT_NOT_FOUND');
      throw error;
    }
  }

  async findById(level: GeographyLevel, id: string, tx?: TransactionContext): Promise<GeographyNode | undefined> {
    return (await this.read(level, `${selectFor(level)} WHERE id = :id`, { id }, tx))[0];
  }

  async findByName(level: GeographyLevel, parentId: string | null, name: string, kind: CenterKind | null, tx?: TransactionContext): Promise<GeographyNode | undefined> {
    const { parent } = TABLE[level];
    const conditions = ['name = :name'];
    const replacements: Record<string, string> = { name };
    if (parent) {
      conditions.push(`${parent} = :parentId`);
      replacements.parentId = parentId ?? '';
    }
    if (level === 'CENTER') {
      conditions.push('kind = :kind');
      replacements.kind = kind ?? '';
    }
    return (await this.read(level, `${selectFor(level)} WHERE ${conditions.join(' AND ')} LIMIT 1`, replacements, tx))[0];
  }

  listChildren(level: GeographyLevel, parentId: string | null, tx?: TransactionContext): Promise<GeographyNode[]> {
    const { parent } = TABLE[level];
    return parent
      ? this.read(level, `${selectFor(level)} WHERE ${parent} = :parentId ORDER BY code ASC`, { parentId: parentId ?? '' }, tx)
      : this.read(level, `${selectFor(level)} ORDER BY code ASC`, {}, tx);
  }

  async nextCodeSequence(level: GeographyLevel, tx?: TransactionContext): Promise<number> {
    const rows = await this.db.query<{ next: number | string }>(
      `SELECT COALESCE(MAX(CAST(SUBSTRING(code, 5) AS UNSIGNED)), 0) + 1 AS next FROM ${TABLE[level].table}`,
      { type: QueryTypes.SELECT, transaction: sequelizeTransactionOf(tx) ?? null },
    );
    return Number(rows[0]?.next ?? 1);
  }

  private async read(level: GeographyLevel, sql: string, replacements: Record<string, string>, tx?: TransactionContext): Promise<GeographyNode[]> {
    const rows = await this.db.query<Row>(sql, { replacements, type: QueryTypes.SELECT, transaction: sequelizeTransactionOf(tx) ?? null });
    return rows.map((row) =>
      GeographyNode.rehydrate({
        id: row.id, level, code: row.code, name: row.name, status: row.status, parentId: row.parentId ?? null,
        kind: level === 'CENTER' ? row.kind : null, createdAt: asDate(row.createdAt), updatedAt: asDate(row.updatedAt),
      }),
    );
  }
}
