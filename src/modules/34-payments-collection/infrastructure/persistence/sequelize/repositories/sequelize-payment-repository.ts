import { QueryTypes, UniqueConstraintError, type Sequelize } from 'sequelize';
import type { TransactionContext } from '../../../../../00-shared-kernel/public';
import { sequelizeTransactionOf } from '../../../../../02-database/public';
import type { PaymentListQuery, PaymentRepository, PaymentStatusCount, PaymentStatusCountQuery } from '../../../../application/ports/payment-repository';
import { Payment } from '../../../../domain/entities/payment';
import { paymentError } from '../../../../domain/errors/payment-errors';
import type { PaymentMethod, PaymentStatus } from '../../../../domain/value-objects/payment-vocabulary';

type Queryable = Pick<Sequelize, 'query'>;

interface PaymentRow {
  id: string;
  subscriptionId: string;
  studentId: string;
  schoolId: string;
  organizationId: string;
  month: string;
  method: PaymentMethod;
  status: PaymentStatus;
  recordedBy: string;
  recordedAt: Date | string;
  reversedBy: string | null;
  reversedAt: Date | string | null;
  reversalReason: string | null;
  updatedAt: Date | string;
  version: number | string;
}

const SELECT = `
  SELECT p.id, p.subscription_id AS subscriptionId, p.student_id AS studentId, p.school_id AS schoolId, p.organization_id AS organizationId, p.month, p.method, p.status,
         p.recorded_by AS recordedBy, p.recorded_at AS recordedAt, p.reversed_by AS reversedBy, p.reversed_at AS reversedAt, p.reversal_reason AS reversalReason,
         p.updated_at AS updatedAt, p.version
    FROM payments p`;

const asDate = (value: Date | string): Date => (value instanceof Date ? value : new Date(value));
const asDateOrNull = (value: Date | string | null): Date | null => (value === null ? null : asDate(value));

export class SequelizePaymentRepository implements PaymentRepository {
  constructor(private readonly db: Queryable) {}

  private t(tx?: TransactionContext) {
    return sequelizeTransactionOf(tx) ?? null;
  }

  async insert(payment: Payment, tx: TransactionContext): Promise<void> {
    const s = payment.snapshot;
    try {
      await this.db.query(
        `INSERT INTO payments (id, subscription_id, student_id, school_id, organization_id, month, method, status, active, recorded_by, recorded_at,
                               reversed_by, reversed_at, reversal_reason, version, created_at, updated_at)
         VALUES (:id, :subscriptionId, :studentId, :schoolId, :organizationId, :month, :method, :status, 1, :recordedBy, :recordedAt, NULL, NULL, NULL, 1, :recordedAt, :recordedAt)`,
        { replacements: { ...s }, transaction: this.t(tx) },
      );
    } catch (error) {
      // UNIQUE (subscription_id, active) is the final guard: a concurrent payment of the same subscription already won.
      if (error instanceof UniqueConstraintError) throw paymentError('PAYMENT_ALREADY_RECORDED');
      throw error;
    }
  }

  async update(payment: Payment, tx: TransactionContext): Promise<void> {
    const s = payment.snapshot;
    const [, affected] = await this.db.query(
      `UPDATE payments
          SET status = :status, active = IF(:status = 'SUCCESSFUL', 1, NULL), reversed_by = :reversedBy, reversed_at = :reversedAt, reversal_reason = :reversalReason,
              updated_at = :updatedAt, version = version + 1
        WHERE id = :id AND version = :version`,
      { replacements: { id: s.id, version: s.version, status: s.status, reversedBy: s.reversedBy, reversedAt: s.reversedAt, reversalReason: s.reversalReason, updatedAt: s.updatedAt }, type: QueryTypes.UPDATE, transaction: this.t(tx) },
    );
    if (Number(affected) !== 1) throw paymentError('PAYMENT_CONCURRENT_MODIFICATION');
  }

  async findById(id: string, tx?: TransactionContext): Promise<Payment | undefined> {
    return (await this.payments(`${SELECT} WHERE p.id = :id`, { id }, tx))[0];
  }
  async lockById(id: string, tx: TransactionContext): Promise<Payment | undefined> {
    return (await this.payments(`${SELECT} WHERE p.id = :id FOR UPDATE`, { id }, tx))[0];
  }

  async list(query: PaymentListQuery, tx?: TransactionContext): Promise<{ items: Payment[]; total: number }> {
    const where = ['p.school_id = :schoolId'];
    const replacements: Record<string, unknown> = { schoolId: query.schoolId };
    if (query.month !== undefined) {
      where.push('p.month = :month');
      replacements.month = query.month;
    }
    if (query.studentId !== undefined) {
      where.push('p.student_id = :studentId');
      replacements.studentId = query.studentId;
    }
    if (query.subscriptionId !== undefined) {
      where.push('p.subscription_id = :subscriptionId');
      replacements.subscriptionId = query.subscriptionId;
    }
    if (query.status && query.status.length > 0) {
      where.push('p.status IN (:statuses)');
      replacements.statuses = [...query.status];
    }
    const clause = where.join(' AND ');
    const dir = query.direction === 'asc' ? 'ASC' : 'DESC';
    const count = await this.db.query<{ n: number | string }>(`SELECT COUNT(*) AS n FROM payments p WHERE ${clause}`, { replacements, type: QueryTypes.SELECT, transaction: this.t(tx) });
    const items = await this.payments(`${SELECT} WHERE ${clause} ORDER BY p.recorded_at ${dir}, p.id ${dir} LIMIT :limit OFFSET :offset`, { ...replacements, limit: query.page.pageSize, offset: (query.page.page - 1) * query.page.pageSize }, tx);
    return { items, total: Number(count[0]?.n ?? 0) };
  }

  async countByStatus(query: PaymentStatusCountQuery, tx?: TransactionContext): Promise<PaymentStatusCount[]> {
    const ids = [...new Set(query.schoolIds)];
    const found: PaymentStatusCount[] = [];
    for (let i = 0; i < ids.length; i += 500) {
      const replacements: Record<string, unknown> = { ids: ids.slice(i, i + 500) };
      let bounds = '';
      if (query.fromMonth !== undefined) {
        bounds += ' AND p.month >= :fromMonth';
        replacements.fromMonth = query.fromMonth;
      }
      if (query.toMonth !== undefined) {
        bounds += ' AND p.month <= :toMonth';
        replacements.toMonth = query.toMonth;
      }
      const rows = await this.db.query<{ schoolId: string; month: string; status: string; total: number | string }>(
        `SELECT p.school_id AS schoolId, p.month AS month, p.status AS status, COUNT(*) AS total FROM payments p WHERE p.school_id IN (:ids)${bounds} GROUP BY p.school_id, p.month, p.status ORDER BY p.school_id, p.month, p.status`,
        { replacements, type: QueryTypes.SELECT, transaction: this.t(tx) },
      );
      for (const r of rows) found.push({ schoolId: r.schoolId, month: r.month, status: r.status as PaymentStatus, count: Number(r.total) });
    }
    return found;
  }

  private async payments(sql: string, replacements: Record<string, unknown>, tx?: TransactionContext): Promise<Payment[]> {
    const rows = await this.db.query<PaymentRow>(sql, { replacements, type: QueryTypes.SELECT, transaction: this.t(tx) });
    return rows.map((r) =>
      Payment.rehydrate({
        id: r.id,
        subscriptionId: r.subscriptionId,
        studentId: r.studentId,
        schoolId: r.schoolId,
        organizationId: r.organizationId,
        month: r.month,
        method: r.method,
        status: r.status,
        recordedBy: r.recordedBy,
        recordedAt: asDate(r.recordedAt),
        reversedBy: r.reversedBy,
        reversedAt: asDateOrNull(r.reversedAt),
        reversalReason: r.reversalReason,
        updatedAt: asDate(r.updatedAt),
        version: Number(r.version),
      }),
    );
  }
}
