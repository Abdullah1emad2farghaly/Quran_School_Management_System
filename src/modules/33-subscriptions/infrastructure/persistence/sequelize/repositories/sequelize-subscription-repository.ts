import { QueryTypes, UniqueConstraintError, type Sequelize } from 'sequelize';
import type { TransactionContext } from '../../../../../00-shared-kernel/public';
import { sequelizeTransactionOf } from '../../../../../02-database/public';
import type { SubscriptionListQuery, SubscriptionRepository } from '../../../../application/ports/subscription-repository';
import { Subscription } from '../../../../domain/entities/subscription';
import { SubscriptionBatch } from '../../../../domain/entities/subscription-batch';
import { subscriptionError } from '../../../../domain/errors/subscription-errors';
import type { SubscriptionStatus } from '../../../../domain/value-objects/subscription-status';

type Queryable = Pick<Sequelize, 'query'>;

interface SubscriptionRow {
  id: string;
  studentId: string;
  schoolId: string;
  organizationId: string;
  month: string;
  status: SubscriptionStatus;
  batchId: string | null;
  createdBy: string;
  createdAt: Date | string;
  paidAt: Date | string | null;
  paidBy: string | null;
  waivedAt: Date | string | null;
  waivedBy: string | null;
  updatedAt: Date | string;
  version: number | string;
}

interface BatchRow {
  id: string;
  schoolId: string;
  organizationId: string;
  month: string;
  count: number | string;
  createdBy: string;
  createdAt: Date | string;
}

const SELECT = `
  SELECT s.id, s.student_id AS studentId, s.school_id AS schoolId, s.organization_id AS organizationId, s.month, s.status, s.batch_id AS batchId,
         s.created_by AS createdBy, s.created_at AS createdAt, s.paid_at AS paidAt, s.paid_by AS paidBy, s.waived_at AS waivedAt, s.waived_by AS waivedBy,
         s.updated_at AS updatedAt, s.version
    FROM subscriptions s`;

const BATCH_SELECT = `SELECT b.id, b.school_id AS schoolId, b.organization_id AS organizationId, b.month, b.record_count AS count, b.created_by AS createdBy, b.created_at AS createdAt FROM subscription_batches b`;

const asDate = (value: Date | string): Date => (value instanceof Date ? value : new Date(value));
const asDateOrNull = (value: Date | string | null): Date | null => (value === null ? null : asDate(value));
const CHUNK = 200;
const IN_CHUNK = 500;

export class SequelizeSubscriptionRepository implements SubscriptionRepository {
  constructor(private readonly db: Queryable) {}

  private t(tx?: TransactionContext) {
    return sequelizeTransactionOf(tx) ?? null;
  }

  // ---------------------------------------------------------------------------------------------- batches

  async insertBatch(batch: SubscriptionBatch, tx: TransactionContext): Promise<void> {
    const s = batch.snapshot;
    try {
      await this.db.query(
        `INSERT INTO subscription_batches (id, school_id, organization_id, month, record_count, created_by, created_at, updated_at)
         VALUES (:id, :schoolId, :organizationId, :month, :count, :createdBy, :createdAt, :createdAt)`,
        { replacements: { ...s }, transaction: this.t(tx) },
      );
    } catch (error) {
      // UNIQUE (school_id, month) is the final guard: a concurrent bulk run of the same school and month already won.
      if (error instanceof UniqueConstraintError) throw subscriptionError('SUBSCRIPTIONS_ALREADY_CREATED_FOR_MONTH');
      throw error;
    }
  }

  async findBatchBySchoolMonth(schoolId: string, month: string, tx?: TransactionContext): Promise<SubscriptionBatch | undefined> {
    return (await this.batches(`${BATCH_SELECT} WHERE b.school_id = :schoolId AND b.month = :month`, { schoolId, month }, tx))[0];
  }
  async findBatchById(batchId: string, tx?: TransactionContext): Promise<SubscriptionBatch | undefined> {
    return (await this.batches(`${BATCH_SELECT} WHERE b.id = :batchId`, { batchId }, tx))[0];
  }

  // ---------------------------------------------------------------------------------------------- subscriptions

  async insertMany(subscriptions: readonly Subscription[], tx: TransactionContext): Promise<void> {
    try {
      for (let i = 0; i < subscriptions.length; i += CHUNK) {
        const chunk = subscriptions.slice(i, i + CHUNK);
        const replacements: Record<string, unknown> = {};
        const rows = chunk.map((subscription, n) => {
          const s = subscription.snapshot;
          replacements[`id${n}`] = s.id;
          replacements[`student${n}`] = s.studentId;
          replacements[`school${n}`] = s.schoolId;
          replacements[`org${n}`] = s.organizationId;
          replacements[`month${n}`] = s.month;
          replacements[`batch${n}`] = s.batchId;
          replacements[`by${n}`] = s.createdBy;
          replacements[`at${n}`] = s.createdAt;
          return `(:id${n}, :student${n}, :school${n}, :org${n}, :month${n}, 'UNPAID', :batch${n}, :by${n}, NULL, NULL, NULL, NULL, 1, :at${n}, :at${n})`;
        });
        await this.db.query(
          `INSERT INTO subscriptions (id, student_id, school_id, organization_id, month, status, batch_id, created_by, paid_at, paid_by, waived_at, waived_by, version, created_at, updated_at)
           VALUES ${rows.join(', ')}`,
          { replacements, transaction: this.t(tx) },
        );
      }
    } catch (error) {
      if (error instanceof UniqueConstraintError) throw subscriptionError('SUBSCRIPTION_ALREADY_EXISTS');
      throw error;
    }
  }

  async insert(subscription: Subscription, tx: TransactionContext): Promise<void> {
    await this.insertMany([subscription], tx);
  }

  async update(subscription: Subscription, tx: TransactionContext): Promise<void> {
    const s = subscription.snapshot;
    const [, affected] = await this.db.query(
      `UPDATE subscriptions
          SET status = :status, paid_at = :paidAt, paid_by = :paidBy, waived_at = :waivedAt, waived_by = :waivedBy, updated_at = :updatedAt, version = version + 1
        WHERE id = :id AND version = :version`,
      { replacements: { id: s.id, version: s.version, status: s.status, paidAt: s.paidAt, paidBy: s.paidBy, waivedAt: s.waivedAt, waivedBy: s.waivedBy, updatedAt: s.updatedAt }, type: QueryTypes.UPDATE, transaction: this.t(tx) },
    );
    if (Number(affected) !== 1) throw subscriptionError('SUBSCRIPTION_CONCURRENT_MODIFICATION');
  }

  async findById(id: string, tx?: TransactionContext): Promise<Subscription | undefined> {
    return (await this.subs(`${SELECT} WHERE s.id = :id`, { id }, tx))[0];
  }
  async lockById(id: string, tx: TransactionContext): Promise<Subscription | undefined> {
    return (await this.subs(`${SELECT} WHERE s.id = :id FOR UPDATE`, { id }, tx))[0];
  }
  lockAllOfStudent(studentId: string, tx: TransactionContext): Promise<Subscription[]> {
    return this.subs(`${SELECT} WHERE s.student_id = :studentId ORDER BY s.month, s.id FOR UPDATE`, { studentId }, tx);
  }
  async findByStudentMonth(studentId: string, month: string, tx?: TransactionContext): Promise<Subscription | undefined> {
    return (await this.subs(`${SELECT} WHERE s.student_id = :studentId AND s.month = :month`, { studentId, month }, tx))[0];
  }

  async list(query: SubscriptionListQuery, tx?: TransactionContext): Promise<{ items: Subscription[]; total: number }> {
    const where = ['s.school_id = :schoolId'];
    const replacements: Record<string, unknown> = { schoolId: query.schoolId };
    if (query.month !== undefined) {
      where.push('s.month = :month');
      replacements.month = query.month;
    }
    if (query.studentId !== undefined) {
      where.push('s.student_id = :studentId');
      replacements.studentId = query.studentId;
    }
    if (query.status && query.status.length > 0) {
      where.push('s.status IN (:statuses)');
      replacements.statuses = [...query.status];
    }
    const clause = where.join(' AND ');
    const dir = query.direction === 'asc' ? 'ASC' : 'DESC';
    const count = await this.db.query<{ n: number | string }>(`SELECT COUNT(*) AS n FROM subscriptions s WHERE ${clause}`, { replacements, type: QueryTypes.SELECT, transaction: this.t(tx) });
    const items = await this.subs(`${SELECT} WHERE ${clause} ORDER BY s.month ${dir}, s.created_at ${dir}, s.id ${dir} LIMIT :limit OFFSET :offset`, { ...replacements, limit: query.page.pageSize, offset: (query.page.page - 1) * query.page.pageSize }, tx);
    return { items, total: Number(count[0]?.n ?? 0) };
  }

  async listByStudentsMonth(studentIds: readonly string[], month: string, tx?: TransactionContext): Promise<Subscription[]> {
    const unique = [...new Set(studentIds)];
    const found: Subscription[] = [];
    for (let i = 0; i < unique.length; i += IN_CHUNK) {
      found.push(...(await this.subs(`${SELECT} WHERE s.month = :month AND s.student_id IN (:ids) ORDER BY s.student_id`, { month, ids: unique.slice(i, i + IN_CHUNK) }, tx)));
    }
    return found;
  }

  listByBatch(batchId: string, tx?: TransactionContext): Promise<Subscription[]> {
    return this.subs(`${SELECT} WHERE s.batch_id = :batchId ORDER BY s.created_at, s.id`, { batchId }, tx);
  }
  listUnpaidOfSchoolMonth(schoolId: string, month: string, tx?: TransactionContext): Promise<Subscription[]> {
    return this.subs(`${SELECT} WHERE s.school_id = :schoolId AND s.month = :month AND s.status = 'UNPAID' ORDER BY s.created_at, s.id`, { schoolId, month }, tx);
  }

  // ---------------------------------------------------------------------------------------------- mapping

  private async subs(sql: string, replacements: Record<string, unknown>, tx?: TransactionContext): Promise<Subscription[]> {
    const rows = await this.db.query<SubscriptionRow>(sql, { replacements, type: QueryTypes.SELECT, transaction: this.t(tx) });
    return rows.map((r) =>
      Subscription.rehydrate({
        id: r.id,
        studentId: r.studentId,
        schoolId: r.schoolId,
        organizationId: r.organizationId,
        month: r.month,
        status: r.status,
        batchId: r.batchId,
        createdBy: r.createdBy,
        createdAt: asDate(r.createdAt),
        paidAt: asDateOrNull(r.paidAt),
        paidBy: r.paidBy,
        waivedAt: asDateOrNull(r.waivedAt),
        waivedBy: r.waivedBy,
        updatedAt: asDate(r.updatedAt),
        version: Number(r.version),
      }),
    );
  }

  private async batches(sql: string, replacements: Record<string, unknown>, tx?: TransactionContext): Promise<SubscriptionBatch[]> {
    const rows = await this.db.query<BatchRow>(sql, { replacements, type: QueryTypes.SELECT, transaction: this.t(tx) });
    return rows.map((r) => SubscriptionBatch.rehydrate({ id: r.id, schoolId: r.schoolId, organizationId: r.organizationId, month: r.month, count: Number(r.count), createdBy: r.createdBy, createdAt: asDate(r.createdAt) }));
  }
}
