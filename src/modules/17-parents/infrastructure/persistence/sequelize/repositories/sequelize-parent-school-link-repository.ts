import { QueryTypes, UniqueConstraintError, type Sequelize } from 'sequelize';
import type { TransactionContext } from '../../../../../00-shared-kernel/public';
import { sequelizeTransactionOf } from '../../../../../02-database/public';
import type { ParentSchoolLinkRepository } from '../../../../application/ports/parent-school-link-repository';
import { ParentSchoolLink } from '../../../../domain/entities/parent-school-link';
import { parentError } from '../../../../domain/errors/parent-errors';

type Queryable = Pick<Sequelize, 'query'>;

interface Row {
  id: string;
  parentId: string;
  userId: string;
  organizationId: string;
  schoolId: string;
  linkedAt: Date | string;
  linkedBy: string;
  unlinkedAt: Date | string | null;
  unlinkedBy: string | null;
  version: number | string;
}

// user_id / organization_id come from the parent (the link row does not duplicate them).
const SELECT = `
  SELECT ps.id, ps.parent_id AS parentId, p.user_id AS userId, p.organization_id AS organizationId, ps.school_id AS schoolId,
         ps.linked_at AS linkedAt, ps.linked_by AS linkedBy, ps.unlinked_at AS unlinkedAt, ps.unlinked_by AS unlinkedBy, ps.version
    FROM parent_schools ps JOIN parents p ON p.id = ps.parent_id`;

const asDate = (value: Date | string): Date => (value instanceof Date ? value : new Date(value));

export class SequelizeParentSchoolLinkRepository implements ParentSchoolLinkRepository {
  constructor(private readonly db: Queryable) {}

  async insert(link: ParentSchoolLink, tx: TransactionContext): Promise<void> {
    const s = link.snapshot;
    try {
      await this.db.query(
        `INSERT INTO parent_schools (id, parent_id, school_id, linked_at, linked_by, unlinked_at, unlinked_by, active, version, created_at, updated_at)
         VALUES (:id, :parentId, :schoolId, :linkedAt, :linkedBy, NULL, NULL, 1, 1, :linkedAt, :linkedAt)`,
        { replacements: { id: s.id, parentId: s.parentId, schoolId: s.schoolId, linkedAt: s.linkedAt, linkedBy: s.linkedBy }, transaction: sequelizeTransactionOf(tx) ?? null },
      );
    } catch (error) {
      // The unique (parent_id, school_id, active) index is the final guard: at most one active link per parent and school.
      if (error instanceof UniqueConstraintError) throw parentError('PARENT_ALREADY_LINKED_TO_SCHOOL');
      throw error;
    }
  }

  async update(link: ParentSchoolLink, tx: TransactionContext): Promise<void> {
    const s = link.snapshot;
    const [, affected] = await this.db.query(
      `UPDATE parent_schools
          SET unlinked_at = :unlinkedAt, unlinked_by = :unlinkedBy, active = IF(:unlinkedAt IS NULL, 1, NULL),
              updated_at = :updatedAt, version = version + 1
        WHERE id = :id AND version = :version`,
      {
        replacements: { id: s.id, version: s.version, unlinkedAt: s.unlinkedAt, unlinkedBy: s.unlinkedBy, updatedAt: s.unlinkedAt ?? s.linkedAt },
        type: QueryTypes.UPDATE,
        transaction: sequelizeTransactionOf(tx) ?? null,
      },
    );
    if (Number(affected) !== 1) throw parentError('PARENT_CONCURRENT_MODIFICATION');
  }

  async findActive(parentId: string, schoolId: string, tx?: TransactionContext): Promise<ParentSchoolLink | undefined> {
    return (await this.find(`${SELECT} WHERE ps.parent_id = :parentId AND ps.school_id = :schoolId AND ps.active = 1`, { parentId, schoolId }, tx))[0];
  }
  async lockActive(parentId: string, schoolId: string, tx: TransactionContext): Promise<ParentSchoolLink | undefined> {
    return (await this.find(`${SELECT} WHERE ps.parent_id = :parentId AND ps.school_id = :schoolId AND ps.active = 1 FOR UPDATE`, { parentId, schoolId }, tx))[0];
  }
  listActiveByParent(parentId: string, tx?: TransactionContext): Promise<ParentSchoolLink[]> {
    return this.find(`${SELECT} WHERE ps.parent_id = :parentId AND ps.active = 1 ORDER BY ps.linked_at, ps.id`, { parentId }, tx);
  }
  async listActiveByParents(parentIds: readonly string[], tx?: TransactionContext): Promise<Map<string, ParentSchoolLink[]>> {
    const result = new Map<string, ParentSchoolLink[]>();
    if (parentIds.length === 0) return result;
    const links = await this.find(`${SELECT} WHERE ps.parent_id IN (:parentIds) AND ps.active = 1 ORDER BY ps.linked_at, ps.id`, { parentIds: [...parentIds] }, tx);
    for (const link of links) {
      const list = result.get(link.snapshot.parentId) ?? [];
      list.push(link);
      result.set(link.snapshot.parentId, list);
    }
    return result;
  }
  listHistoryByParent(parentId: string, tx?: TransactionContext): Promise<ParentSchoolLink[]> {
    return this.find(`${SELECT} WHERE ps.parent_id = :parentId ORDER BY ps.linked_at, ps.id`, { parentId }, tx);
  }

  private async find(sql: string, replacements: Record<string, unknown>, tx?: TransactionContext): Promise<ParentSchoolLink[]> {
    const rows = await this.db.query<Row>(sql, { replacements, type: QueryTypes.SELECT, transaction: sequelizeTransactionOf(tx) ?? null });
    return rows.map((r) =>
      ParentSchoolLink.rehydrate({
        id: r.id,
        parentId: r.parentId,
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
