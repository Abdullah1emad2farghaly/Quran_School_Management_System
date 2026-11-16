import { QueryTypes, UniqueConstraintError, type Sequelize } from 'sequelize';
import type { TransactionContext } from '../../../../../00-shared-kernel/public';
import { sequelizeTransactionOf } from '../../../../../02-database/public';
import type { CollectorLinkRepository } from '../../../../application/ports/collector-link-repository';
import { CollectorSchoolLink } from '../../../../domain/entities/collector-school-link';
import { subscriptionError } from '../../../../domain/errors/subscription-errors';

type Queryable = Pick<Sequelize, 'query'>;

interface Row {
  id: string;
  userId: string;
  organizationId: string;
  schoolId: string;
  linkedAt: Date | string;
  linkedBy: string;
  unlinkedAt: Date | string | null;
  unlinkedBy: string | null;
  version: number | string;
}

const SELECT = `
  SELECT l.id, l.user_id AS userId, l.organization_id AS organizationId, l.school_id AS schoolId, l.linked_at AS linkedAt, l.linked_by AS linkedBy,
         l.unlinked_at AS unlinkedAt, l.unlinked_by AS unlinkedBy, l.version
    FROM collector_school_links l`;

const asDate = (value: Date | string): Date => (value instanceof Date ? value : new Date(value));

export class SequelizeCollectorLinkRepository implements CollectorLinkRepository {
  constructor(private readonly db: Queryable) {}

  async insert(link: CollectorSchoolLink, tx: TransactionContext): Promise<void> {
    const s = link.snapshot;
    try {
      await this.db.query(
        `INSERT INTO collector_school_links (id, user_id, organization_id, school_id, linked_at, linked_by, unlinked_at, unlinked_by, active, version, created_at, updated_at)
         VALUES (:id, :userId, :organizationId, :schoolId, :linkedAt, :linkedBy, NULL, NULL, 1, 1, :linkedAt, :linkedAt)`,
        { replacements: { id: s.id, userId: s.userId, organizationId: s.organizationId, schoolId: s.schoolId, linkedAt: s.linkedAt, linkedBy: s.linkedBy }, transaction: sequelizeTransactionOf(tx) ?? null },
      );
    } catch (error) {
      // The unique (user_id, school_id, active) index is the final guard: at most one active link per account and school.
      if (error instanceof UniqueConstraintError) throw subscriptionError('COLLECTOR_ALREADY_LINKED_TO_SCHOOL');
      throw error;
    }
  }

  async update(link: CollectorSchoolLink, tx: TransactionContext): Promise<void> {
    const s = link.snapshot;
    const [, affected] = await this.db.query(
      `UPDATE collector_school_links
          SET unlinked_at = :unlinkedAt, unlinked_by = :unlinkedBy, active = IF(:unlinkedAt IS NULL, 1, NULL), updated_at = :updatedAt, version = version + 1
        WHERE id = :id AND version = :version`,
      { replacements: { id: s.id, version: s.version, unlinkedAt: s.unlinkedAt, unlinkedBy: s.unlinkedBy, updatedAt: s.unlinkedAt ?? s.linkedAt }, type: QueryTypes.UPDATE, transaction: sequelizeTransactionOf(tx) ?? null },
    );
    if (Number(affected) !== 1) throw subscriptionError('COLLECTOR_CONCURRENT_MODIFICATION');
  }

  async findActive(userId: string, schoolId: string, tx?: TransactionContext): Promise<CollectorSchoolLink | undefined> {
    return (await this.find(`${SELECT} WHERE l.user_id = :userId AND l.school_id = :schoolId AND l.active = 1`, { userId, schoolId }, tx))[0];
  }
  async lockActive(userId: string, schoolId: string, tx: TransactionContext): Promise<CollectorSchoolLink | undefined> {
    return (await this.find(`${SELECT} WHERE l.user_id = :userId AND l.school_id = :schoolId AND l.active = 1 FOR UPDATE`, { userId, schoolId }, tx))[0];
  }
  listActiveByUser(userId: string, tx?: TransactionContext): Promise<CollectorSchoolLink[]> {
    return this.find(`${SELECT} WHERE l.user_id = :userId AND l.active = 1 ORDER BY l.linked_at, l.id`, { userId }, tx);
  }
  listActiveBySchool(schoolId: string, tx?: TransactionContext): Promise<CollectorSchoolLink[]> {
    return this.find(`${SELECT} WHERE l.school_id = :schoolId AND l.active = 1 ORDER BY l.linked_at, l.id`, { schoolId }, tx);
  }
  listHistoryByUser(userId: string, tx?: TransactionContext): Promise<CollectorSchoolLink[]> {
    return this.find(`${SELECT} WHERE l.user_id = :userId ORDER BY l.linked_at, l.id`, { userId }, tx);
  }
  async findOrganizationOfUser(userId: string, tx?: TransactionContext): Promise<string | undefined> {
    const rows = await this.db.query<{ organizationId: string }>('SELECT organization_id AS organizationId FROM collector_school_links WHERE user_id = :userId LIMIT 1', {
      replacements: { userId },
      type: QueryTypes.SELECT,
      transaction: sequelizeTransactionOf(tx) ?? null,
    });
    return rows[0]?.organizationId;
  }

  private async find(sql: string, replacements: Record<string, unknown>, tx?: TransactionContext): Promise<CollectorSchoolLink[]> {
    const rows = await this.db.query<Row>(sql, { replacements, type: QueryTypes.SELECT, transaction: sequelizeTransactionOf(tx) ?? null });
    return rows.map((r) =>
      CollectorSchoolLink.rehydrate({
        id: r.id,
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
