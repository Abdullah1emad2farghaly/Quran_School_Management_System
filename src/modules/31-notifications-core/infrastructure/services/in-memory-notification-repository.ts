import { pageOffset, type PageRequest, type TransactionContext } from '../../../00-shared-kernel/public';
import type {
  ClaimParams,
  DeliveryForSend,
  NewPushDelivery,
  NotificationRecord,
  NotificationRepository,
  PushSubscriptionRecord,
} from '../../application/ports/notification-repository';

interface DeliveryRow extends NewPushDelivery {
  status: 'PENDING' | 'FAILED';
  attempts: number;
  nextAttemptAt: Date;
  lockedUntil: Date | null;
  lastError: string | null;
  failedAt: Date | null;
}

/**
 * In-memory NotificationRepository with the same rules as the MariaDB one (unique once-only key, unique endpoint, owner-scoped methods, hard delete with cascade to
 * deliveries, a once-only key that outlives its notification). For tests. It is not transactional: a failed unit of work does not undo earlier writes.
 */
export class InMemoryNotificationRepository implements NotificationRepository {
  readonly dedupKeys = new Map<string, Date>();
  readonly notifications = new Map<string, NotificationRecord>();
  readonly subscriptions = new Map<string, PushSubscriptionRecord>();
  readonly deliveries = new Map<string, DeliveryRow>();

  async insertDedupKey(recipientUserId: string, dedupKey: string, now: Date, _tx: TransactionContext): Promise<boolean> {
    const key = `${recipientUserId}\u0000${dedupKey}`;
    if (this.dedupKeys.has(key)) return false;
    this.dedupKeys.set(key, now);
    return true;
  }

  async insertNotification(record: NotificationRecord, _tx: TransactionContext): Promise<void> {
    this.notifications.set(record.id, { ...record });
  }

  async listNotifications(userId: string, options: { unreadOnly: boolean; newestFirst: boolean; page: PageRequest }) {
    const all = [...this.notifications.values()]
      .filter((n) => n.recipientUserId === userId && (!options.unreadOnly || n.readAt === null))
      .sort((a, b) => (a.createdAt.getTime() - b.createdAt.getTime()) * (options.newestFirst ? -1 : 1) || a.id.localeCompare(b.id));
    const offset = pageOffset(options.page);
    return { items: all.slice(offset, offset + options.page.pageSize).map((n) => ({ ...n })), total: all.length };
  }

  async countUnread(userId: string): Promise<number> {
    return [...this.notifications.values()].filter((n) => n.recipientUserId === userId && n.readAt === null).length;
  }

  async markRead(userId: string, notificationId: string, now: Date, _tx: TransactionContext): Promise<void> {
    const n = this.notifications.get(notificationId);
    if (n && n.recipientUserId === userId && n.readAt === null) this.notifications.set(n.id, { ...n, readAt: now });
  }

  async markAllRead(userId: string, now: Date, _tx: TransactionContext): Promise<number> {
    let count = 0;
    for (const n of this.notifications.values()) {
      if (n.recipientUserId === userId && n.readAt === null) {
        this.notifications.set(n.id, { ...n, readAt: now });
        count += 1;
      }
    }
    return count;
  }

  async deleteNotification(userId: string, notificationId: string, _tx: TransactionContext): Promise<number> {
    const n = this.notifications.get(notificationId);
    if (!n || n.recipientUserId !== userId) return 0;
    this.notifications.delete(notificationId);
    for (const d of [...this.deliveries.values()]) if (d.notificationId === notificationId) this.deliveries.delete(d.id);
    return 1;
  }

  async deleteAllNotifications(userId: string, _tx: TransactionContext): Promise<number> {
    let count = 0;
    for (const n of [...this.notifications.values()]) {
      if (n.recipientUserId !== userId) continue;
      this.notifications.delete(n.id);
      count += 1;
    }
    for (const d of [...this.deliveries.values()]) if (d.recipientUserId === userId && !this.notifications.has(d.notificationId)) this.deliveries.delete(d.id);
    return count;
  }

  async upsertSubscription(record: Omit<PushSubscriptionRecord, 'lastSuccessAt' | 'consecutiveFailures'>, _tx: TransactionContext): Promise<PushSubscriptionRecord> {
    const existing = [...this.subscriptions.values()].find((s) => s.endpoint === record.endpoint);
    if (existing) {
      if (existing.userId !== record.userId) this.dropDeliveriesOf(existing.id); // never deliver the previous account's notifications to the new account
      const updated: PushSubscriptionRecord = { ...existing, userId: record.userId, sessionId: record.sessionId, p256dh: record.p256dh, auth: record.auth, consecutiveFailures: 0 };
      this.subscriptions.set(existing.id, updated);
      return { ...updated };
    }
    const created: PushSubscriptionRecord = { ...record, lastSuccessAt: null, consecutiveFailures: 0 };
    this.subscriptions.set(created.id, created);
    return { ...created };
  }

  async countSubscriptionsExcludingEndpoint(userId: string, endpoint: string, _tx: TransactionContext): Promise<number> {
    return [...this.subscriptions.values()].filter((s) => s.userId === userId && s.endpoint !== endpoint).length;
  }

  async listSubscriptionsOfUser(userId: string, _tx?: TransactionContext): Promise<PushSubscriptionRecord[]> {
    return [...this.subscriptions.values()].filter((s) => s.userId === userId).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()).map((s) => ({ ...s }));
  }

  async deleteSubscriptionByEndpoint(userId: string, endpoint: string, _tx: TransactionContext): Promise<number> {
    const s = [...this.subscriptions.values()].find((x) => x.userId === userId && x.endpoint === endpoint);
    if (!s) return 0;
    this.removeSubscription(s.id);
    return 1;
  }

  async deleteSubscriptionsBySession(sessionId: string, _tx: TransactionContext): Promise<number> {
    const ids = [...this.subscriptions.values()].filter((s) => s.sessionId === sessionId).map((s) => s.id);
    for (const id of ids) this.removeSubscription(id);
    return ids.length;
  }

  async deleteSubscription(subscriptionId: string, _tx: TransactionContext): Promise<void> {
    this.removeSubscription(subscriptionId);
  }

  async recordSubscriptionSuccess(subscriptionId: string, now: Date, _tx: TransactionContext): Promise<void> {
    const s = this.subscriptions.get(subscriptionId);
    if (s) this.subscriptions.set(s.id, { ...s, lastSuccessAt: now, consecutiveFailures: 0 });
  }

  async recordSubscriptionFailure(subscriptionId: string, _tx: TransactionContext): Promise<number> {
    const s = this.subscriptions.get(subscriptionId);
    if (!s) return 0;
    const next = { ...s, consecutiveFailures: s.consecutiveFailures + 1 };
    this.subscriptions.set(s.id, next);
    return next.consecutiveFailures;
  }

  async insertDeliveries(rows: readonly NewPushDelivery[], _tx: TransactionContext): Promise<void> {
    for (const r of rows) this.deliveries.set(r.id, { ...r, status: 'PENDING', attempts: 0, nextAttemptAt: r.createdAt, lockedUntil: null, lastError: null, failedAt: null });
  }

  async claimDeliveries(p: ClaimParams): Promise<DeliveryForSend[]> {
    const due = [...this.deliveries.values()]
      .filter((d) => d.status === 'PENDING' && d.nextAttemptAt.getTime() <= p.now.getTime() && (d.lockedUntil === null || d.lockedUntil.getTime() < p.now.getTime()))
      .sort((a, b) => a.nextAttemptAt.getTime() - b.nextAttemptAt.getTime() || a.id.localeCompare(b.id))
      .slice(0, p.limit);
    const out: DeliveryForSend[] = [];
    for (const d of due) {
      const subscription = this.subscriptions.get(d.subscriptionId);
      const notification = this.notifications.get(d.notificationId);
      if (!subscription || !notification) {
        this.deliveries.delete(d.id); // orphan: its notification or subscription is gone
        continue;
      }
      d.lockedUntil = p.lockUntil;
      out.push({
        deliveryId: d.id,
        attempts: d.attempts,
        subscription: { id: subscription.id, endpoint: subscription.endpoint, p256dh: subscription.p256dh, auth: subscription.auth },
        notification: { id: notification.id, type: notification.type, title: notification.title, body: notification.body },
      });
    }
    return out;
  }

  async completeDelivery(deliveryId: string, _tx: TransactionContext): Promise<void> {
    this.deliveries.delete(deliveryId);
  }

  async rescheduleDelivery(deliveryId: string, attempts: number, nextAttemptAt: Date, error: string, _tx: TransactionContext): Promise<void> {
    const d = this.deliveries.get(deliveryId);
    if (d) Object.assign(d, { attempts, nextAttemptAt, lastError: error, lockedUntil: null });
  }

  async failDelivery(deliveryId: string, attempts: number, error: string, now: Date, _tx: TransactionContext): Promise<void> {
    const d = this.deliveries.get(deliveryId);
    if (d) Object.assign(d, { status: 'FAILED', attempts, lastError: error, lockedUntil: null, failedAt: now });
  }

  async deleteFailedDeliveriesBefore(cutoff: Date): Promise<number> {
    let count = 0;
    for (const d of [...this.deliveries.values()]) {
      if (d.status === 'FAILED' && d.failedAt !== null && d.failedAt.getTime() < cutoff.getTime()) {
        this.deliveries.delete(d.id);
        count += 1;
      }
    }
    return count;
  }

  private removeSubscription(id: string): void {
    this.subscriptions.delete(id);
    this.dropDeliveriesOf(id);
  }

  private dropDeliveriesOf(subscriptionId: string): void {
    for (const d of [...this.deliveries.values()]) if (d.subscriptionId === subscriptionId) this.deliveries.delete(d.id);
  }
}
