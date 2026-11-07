import { createHash } from 'node:crypto';
import { QueryTypes, UniqueConstraintError, type Sequelize } from 'sequelize';
import { pageOffset, type PageRequest, type TransactionContext } from '../../../../../00-shared-kernel/public';
import { sequelizeTransactionOf } from '../../../../../02-database/public';
import type {
  ClaimParams,
  DeliveryForSend,
  NewPushDelivery,
  NotificationRecord,
  NotificationRepository,
  PushSubscriptionRecord,
} from '../../../../application/ports/notification-repository';

type Queryable = Pick<Sequelize, 'query'>;
type D = Date | string;
const asDate = (v: D): Date => (v instanceof Date ? v : new Date(v));
const asDateOrNull = (v: D | null): Date | null => (v === null ? null : asDate(v));
/** The unique key of an endpoint (its text is too long for an index). */
const endpointHash = (endpoint: string): string => createHash('sha256').update(endpoint).digest('hex');

interface NotificationRow {
  id: string;
  recipientUserId: string;
  type: string;
  title: string;
  body: string;
  data: string | null;
  readAt: D | null;
  createdAt: D;
}
interface SubscriptionRow {
  id: string;
  userId: string;
  sessionId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  createdAt: D;
  lastSuccessAt: D | null;
  consecutiveFailures: number | string;
}
const NOTIFICATION_SELECT = `SELECT id, recipient_user_id AS recipientUserId, type, title, body, data, read_at AS readAt, created_at AS createdAt FROM notifications`;
const SUBSCRIPTION_SELECT = `SELECT id, user_id AS userId, auth_session_id AS sessionId, endpoint, p256dh, auth, created_at AS createdAt, last_success_at AS lastSuccessAt,
  consecutive_failures AS consecutiveFailures FROM push_subscriptions`;

const toNotification = (r: NotificationRow): NotificationRecord => ({
  id: r.id, recipientUserId: r.recipientUserId, type: r.type, title: r.title, body: r.body, data: r.data, readAt: asDateOrNull(r.readAt), createdAt: asDate(r.createdAt),
});
const toSubscription = (r: SubscriptionRow): PushSubscriptionRecord => ({
  id: r.id, userId: r.userId, sessionId: r.sessionId, endpoint: r.endpoint, p256dh: r.p256dh, auth: r.auth, createdAt: asDate(r.createdAt),
  lastSuccessAt: asDateOrNull(r.lastSuccessAt), consecutiveFailures: Number(r.consecutiveFailures),
});

/**
 * MariaDB NotificationRepository (Module 31's own tables). Every notification statement is scoped by the owner (`recipient_user_id`), so no method can touch another
 * account's row. Deleting a notification is a real DELETE: its `push_deliveries` go with it through the foreign key (`ON DELETE CASCADE`, own tables only), and nothing
 * ever deletes `notification_dedup_keys` rows. Timestamps are UTC.
 */
export class SequelizeNotificationRepository implements NotificationRepository {
  constructor(private readonly db: Queryable) {}

  private t(tx?: TransactionContext) {
    return sequelizeTransactionOf(tx) ?? null;
  }

  private async affected(sql: string, replacements: Record<string, unknown>, tx: TransactionContext, kind: 'update' | 'delete'): Promise<number> {
    if (kind === 'delete') {
      const n = await this.db.query(sql, { replacements, type: QueryTypes.BULKDELETE, transaction: this.t(tx) });
      return Number(n);
    }
    const [, n] = await this.db.query(sql, { replacements, type: QueryTypes.UPDATE, transaction: this.t(tx) });
    return Number(n);
  }

  // ---- once-only keys ----
  async insertDedupKey(recipientUserId: string, dedupKey: string, now: Date, tx: TransactionContext): Promise<boolean> {
    try {
      await this.db.query('INSERT INTO notification_dedup_keys (recipient_user_id, dedup_key, created_at) VALUES (:recipientUserId, :dedupKey, :now)', {
        replacements: { recipientUserId, dedupKey, now },
        transaction: this.t(tx),
      });
      return true;
    } catch (error) {
      if (error instanceof UniqueConstraintError) return false; // already recorded: do not create the notification again
      throw error;
    }
  }

  // ---- notifications ----
  async insertNotification(r: NotificationRecord, tx: TransactionContext): Promise<void> {
    await this.db.query(
      `INSERT INTO notifications (id, recipient_user_id, type, title, body, data, read_at, created_at)
       VALUES (:id, :recipientUserId, :type, :title, :body, :data, NULL, :createdAt)`,
      { replacements: { id: r.id, recipientUserId: r.recipientUserId, type: r.type, title: r.title, body: r.body, data: r.data, createdAt: r.createdAt }, transaction: this.t(tx) },
    );
  }

  async listNotifications(userId: string, options: { unreadOnly: boolean; newestFirst: boolean; page: PageRequest }) {
    const where = `recipient_user_id = :userId${options.unreadOnly ? ' AND read_at IS NULL' : ''}`;
    const direction = options.newestFirst ? 'DESC' : 'ASC';
    const [{ total }] = await this.db.query<{ total: number | string }>(`SELECT COUNT(*) AS total FROM notifications WHERE ${where}`, { replacements: { userId }, type: QueryTypes.SELECT });
    const rows = await this.db.query<NotificationRow>(`${NOTIFICATION_SELECT} WHERE ${where} ORDER BY created_at ${direction}, id ${direction} LIMIT :limit OFFSET :offset`, {
      replacements: { userId, limit: options.page.pageSize, offset: pageOffset(options.page) },
      type: QueryTypes.SELECT,
    });
    return { items: rows.map(toNotification), total: Number(total) };
  }

  async countUnread(userId: string): Promise<number> {
    const [{ total }] = await this.db.query<{ total: number | string }>('SELECT COUNT(*) AS total FROM notifications WHERE recipient_user_id = :userId AND read_at IS NULL', {
      replacements: { userId },
      type: QueryTypes.SELECT,
    });
    return Number(total);
  }

  async markRead(userId: string, notificationId: string, now: Date, tx: TransactionContext): Promise<void> {
    await this.affected('UPDATE notifications SET read_at = :now WHERE id = :id AND recipient_user_id = :userId AND read_at IS NULL', { now, id: notificationId, userId }, tx, 'update');
  }

  markAllRead(userId: string, now: Date, tx: TransactionContext): Promise<number> {
    return this.affected('UPDATE notifications SET read_at = :now WHERE recipient_user_id = :userId AND read_at IS NULL', { now, userId }, tx, 'update');
  }

  deleteNotification(userId: string, notificationId: string, tx: TransactionContext): Promise<number> {
    return this.affected('DELETE FROM notifications WHERE id = :id AND recipient_user_id = :userId', { id: notificationId, userId }, tx, 'delete');
  }

  deleteAllNotifications(userId: string, tx: TransactionContext): Promise<number> {
    return this.affected('DELETE FROM notifications WHERE recipient_user_id = :userId', { userId }, tx, 'delete');
  }

  // ---- push subscriptions ----
  async upsertSubscription(r: Omit<PushSubscriptionRecord, 'lastSuccessAt' | 'consecutiveFailures'>, tx: TransactionContext): Promise<PushSubscriptionRecord> {
    const hash = endpointHash(r.endpoint);
    const existing = (await this.db.query<SubscriptionRow>(`${SUBSCRIPTION_SELECT} WHERE endpoint_hash = :hash FOR UPDATE`, { replacements: { hash }, type: QueryTypes.SELECT, transaction: this.t(tx) }))[0];
    if (existing) {
      if (existing.userId !== r.userId) {
        // The browser now belongs to another account: what was queued for the previous account must never reach it.
        await this.db.query('DELETE FROM push_deliveries WHERE subscription_id = :id', { replacements: { id: existing.id }, transaction: this.t(tx) });
      }
      await this.db.query(
        `UPDATE push_subscriptions SET user_id = :userId, auth_session_id = :sessionId, p256dh = :p256dh, auth = :auth, consecutive_failures = 0, updated_at = :now WHERE id = :id`,
        { replacements: { id: existing.id, userId: r.userId, sessionId: r.sessionId, p256dh: r.p256dh, auth: r.auth, now: r.createdAt }, transaction: this.t(tx) },
      );
      return toSubscription({ ...existing, userId: r.userId, sessionId: r.sessionId, p256dh: r.p256dh, auth: r.auth, consecutiveFailures: 0 });
    }
    await this.db.query(
      `INSERT INTO push_subscriptions (id, user_id, auth_session_id, endpoint, endpoint_hash, p256dh, auth, created_at, updated_at, last_success_at, consecutive_failures)
       VALUES (:id, :userId, :sessionId, :endpoint, :hash, :p256dh, :auth, :createdAt, :createdAt, NULL, 0)`,
      { replacements: { id: r.id, userId: r.userId, sessionId: r.sessionId, endpoint: r.endpoint, hash, p256dh: r.p256dh, auth: r.auth, createdAt: r.createdAt }, transaction: this.t(tx) },
    );
    return { ...r, lastSuccessAt: null, consecutiveFailures: 0 };
  }

  async countSubscriptionsExcludingEndpoint(userId: string, endpoint: string, tx: TransactionContext): Promise<number> {
    const [{ total }] = await this.db.query<{ total: number | string }>('SELECT COUNT(*) AS total FROM push_subscriptions WHERE user_id = :userId AND endpoint_hash <> :hash', {
      replacements: { userId, hash: endpointHash(endpoint) },
      type: QueryTypes.SELECT,
      transaction: this.t(tx),
    });
    return Number(total);
  }

  async listSubscriptionsOfUser(userId: string, tx?: TransactionContext): Promise<PushSubscriptionRecord[]> {
    const rows = await this.db.query<SubscriptionRow>(`${SUBSCRIPTION_SELECT} WHERE user_id = :userId ORDER BY created_at ASC, id ASC`, { replacements: { userId }, type: QueryTypes.SELECT, transaction: this.t(tx) });
    return rows.map(toSubscription);
  }

  deleteSubscriptionByEndpoint(userId: string, endpoint: string, tx: TransactionContext): Promise<number> {
    return this.affected('DELETE FROM push_subscriptions WHERE user_id = :userId AND endpoint_hash = :hash', { userId, hash: endpointHash(endpoint) }, tx, 'delete');
  }

  deleteSubscriptionsBySession(sessionId: string, tx: TransactionContext): Promise<number> {
    return this.affected('DELETE FROM push_subscriptions WHERE auth_session_id = :sessionId', { sessionId }, tx, 'delete');
  }

  async deleteSubscription(subscriptionId: string, tx: TransactionContext): Promise<void> {
    await this.affected('DELETE FROM push_subscriptions WHERE id = :id', { id: subscriptionId }, tx, 'delete');
  }

  async recordSubscriptionSuccess(subscriptionId: string, now: Date, tx: TransactionContext): Promise<void> {
    await this.affected('UPDATE push_subscriptions SET last_success_at = :now, consecutive_failures = 0 WHERE id = :id', { id: subscriptionId, now }, tx, 'update');
  }

  async recordSubscriptionFailure(subscriptionId: string, tx: TransactionContext): Promise<number> {
    await this.affected('UPDATE push_subscriptions SET consecutive_failures = consecutive_failures + 1 WHERE id = :id', { id: subscriptionId }, tx, 'update');
    const rows = await this.db.query<{ n: number | string }>('SELECT consecutive_failures AS n FROM push_subscriptions WHERE id = :id', { replacements: { id: subscriptionId }, type: QueryTypes.SELECT, transaction: this.t(tx) });
    return rows[0] ? Number(rows[0].n) : 0;
  }

  // ---- push deliveries ----
  async insertDeliveries(rows: readonly NewPushDelivery[], tx: TransactionContext): Promise<void> {
    for (const r of rows) {
      await this.db.query(
        `INSERT INTO push_deliveries (id, notification_id, subscription_id, recipient_user_id, status, attempts, next_attempt_at, locked_until, last_error, created_at, failed_at)
         VALUES (:id, :notificationId, :subscriptionId, :recipientUserId, 'PENDING', 0, :createdAt, NULL, NULL, :createdAt, NULL)`,
        { replacements: { id: r.id, notificationId: r.notificationId, subscriptionId: r.subscriptionId, recipientUserId: r.recipientUserId, createdAt: r.createdAt }, transaction: this.t(tx) },
      );
    }
  }

  async claimDeliveries(p: ClaimParams): Promise<DeliveryForSend[]> {
    // Same claim pattern as the outbox: lock the due rows for this pass, then read what was locked.
    await this.db.query(
      `UPDATE push_deliveries SET locked_until = :lockUntil, claim_id = :claimId
        WHERE status = 'PENDING' AND next_attempt_at <= :now AND (locked_until IS NULL OR locked_until < :now)
        ORDER BY next_attempt_at ASC, id ASC LIMIT :limit`,
      { replacements: { claimId: p.claimId, lockUntil: p.lockUntil, now: p.now, limit: p.limit } },
    );
    const rows = await this.db.query<{
      deliveryId: string; attempts: number | string; subscriptionId: string | null; endpoint: string | null; p256dh: string | null; auth: string | null;
      notificationId: string | null; type: string | null; title: string | null; body: string | null;
    }>(
      `SELECT d.id AS deliveryId, d.attempts, s.id AS subscriptionId, s.endpoint, s.p256dh, s.auth, n.id AS notificationId, n.type, n.title, n.body
         FROM push_deliveries d
         LEFT JOIN push_subscriptions s ON s.id = d.subscription_id
         LEFT JOIN notifications n ON n.id = d.notification_id
        WHERE d.claim_id = :claimId AND d.status = 'PENDING'
        ORDER BY d.next_attempt_at ASC, d.id ASC`,
      { replacements: { claimId: p.claimId }, type: QueryTypes.SELECT },
    );
    const out: DeliveryForSend[] = [];
    const orphans: string[] = [];
    for (const r of rows) {
      if (r.subscriptionId === null || r.notificationId === null || r.endpoint === null || r.p256dh === null || r.auth === null || r.type === null || r.title === null || r.body === null) {
        orphans.push(r.deliveryId); // cannot normally happen (foreign keys cascade); cleaned up defensively
        continue;
      }
      out.push({
        deliveryId: r.deliveryId,
        attempts: Number(r.attempts),
        subscription: { id: r.subscriptionId, endpoint: r.endpoint, p256dh: r.p256dh, auth: r.auth },
        notification: { id: r.notificationId, type: r.type, title: r.title, body: r.body },
      });
    }
    if (orphans.length > 0) await this.db.query('DELETE FROM push_deliveries WHERE id IN (:ids)', { replacements: { ids: orphans } });
    return out;
  }

  async completeDelivery(deliveryId: string, tx: TransactionContext): Promise<void> {
    await this.affected('DELETE FROM push_deliveries WHERE id = :id', { id: deliveryId }, tx, 'delete');
  }

  async rescheduleDelivery(deliveryId: string, attempts: number, nextAttemptAt: Date, error: string, tx: TransactionContext): Promise<void> {
    await this.affected('UPDATE push_deliveries SET attempts = :attempts, next_attempt_at = :nextAttemptAt, last_error = :error, locked_until = NULL, claim_id = NULL WHERE id = :id', { id: deliveryId, attempts, nextAttemptAt, error: error.slice(0, 100) }, tx, 'update');
  }

  async failDelivery(deliveryId: string, attempts: number, error: string, now: Date, tx: TransactionContext): Promise<void> {
    await this.affected("UPDATE push_deliveries SET status = 'FAILED', attempts = :attempts, last_error = :error, locked_until = NULL, claim_id = NULL, failed_at = :now WHERE id = :id", { id: deliveryId, attempts, error: error.slice(0, 100), now }, tx, 'update');
  }

  async deleteFailedDeliveriesBefore(cutoff: Date): Promise<number> {
    const n = await this.db.query("DELETE FROM push_deliveries WHERE status = 'FAILED' AND failed_at < :cutoff", { replacements: { cutoff }, type: QueryTypes.BULKDELETE });
    return Number(n);
  }
}
