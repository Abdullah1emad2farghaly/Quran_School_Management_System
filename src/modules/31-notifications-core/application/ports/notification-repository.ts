import type { PageRequest, TransactionContext } from '../../../00-shared-kernel/public';

export interface NotificationRecord {
  readonly id: string;
  readonly recipientUserId: string;
  readonly type: string;
  readonly title: string;
  readonly body: string;
  /** JSON text or null. */
  readonly data: string | null;
  readonly readAt: Date | null;
  readonly createdAt: Date;
}

export interface PushSubscriptionRecord {
  readonly id: string;
  readonly userId: string;
  /** The authentication session (Module 10) that created it: when that session ends, the subscription is deleted. */
  readonly sessionId: string;
  readonly endpoint: string;
  readonly p256dh: string;
  readonly auth: string;
  readonly createdAt: Date;
  readonly lastSuccessAt: Date | null;
  readonly consecutiveFailures: number;
}

export interface NewPushDelivery {
  readonly id: string;
  readonly notificationId: string;
  readonly subscriptionId: string;
  readonly recipientUserId: string;
  readonly createdAt: Date;
}

/** A claimed delivery with everything needed to send it. */
export interface DeliveryForSend {
  readonly deliveryId: string;
  readonly attempts: number;
  readonly subscription: { readonly id: string; readonly endpoint: string; readonly p256dh: string; readonly auth: string };
  readonly notification: { readonly id: string; readonly type: string; readonly title: string; readonly body: string };
}

export interface ClaimParams {
  readonly claimId: string;
  readonly now: Date;
  readonly lockUntil: Date;
  readonly limit: number;
}

/**
 * Persistence of Module 31 (its own tables only). Every notification method is scoped by the OWNER account: no method can read, change or delete another
 * account's notification. Deleting a notification is a HARD delete (the row and its push deliveries); the once-only key survives it (Q1).
 */
export interface NotificationRepository {
  // ---- once-only keys (Q1) ----
  /** Records `(recipient, key)`. Returns false when it already exists (nothing is written then). Never deleted by anything. */
  insertDedupKey(recipientUserId: string, dedupKey: string, now: Date, tx: TransactionContext): Promise<boolean>;

  // ---- notifications ----
  insertNotification(record: NotificationRecord, tx: TransactionContext): Promise<void>;
  listNotifications(userId: string, options: { unreadOnly: boolean; newestFirst: boolean; page: PageRequest }): Promise<{ items: NotificationRecord[]; total: number }>;
  countUnread(userId: string): Promise<number>;
  /** Sets `read_at` only when it is still empty (the first read time is kept). Another account's id changes nothing. */
  markRead(userId: string, notificationId: string, now: Date, tx: TransactionContext): Promise<void>;
  markAllRead(userId: string, now: Date, tx: TransactionContext): Promise<number>;
  /** HARD delete of one notification of this account and its push deliveries. Returns how many notifications were deleted (0 or 1). */
  deleteNotification(userId: string, notificationId: string, tx: TransactionContext): Promise<number>;
  /** HARD delete of every notification of this account and their push deliveries. */
  deleteAllNotifications(userId: string, tx: TransactionContext): Promise<number>;

  // ---- push subscriptions ----
  /**
   * Creates or updates the subscription with this endpoint. An endpoint belongs to ONE account/session at a time: subscribing again from the same browser
   * with another account moves it, and the deliveries still pending for the previous account are deleted so they never reach the new one.
   */
  upsertSubscription(record: Omit<PushSubscriptionRecord, 'lastSuccessAt' | 'consecutiveFailures'>, tx: TransactionContext): Promise<PushSubscriptionRecord>;
  countSubscriptionsExcludingEndpoint(userId: string, endpoint: string, tx: TransactionContext): Promise<number>;
  listSubscriptionsOfUser(userId: string, tx?: TransactionContext): Promise<PushSubscriptionRecord[]>;
  /** Deletes the account's subscription with this endpoint (and its deliveries). Idempotent. */
  deleteSubscriptionByEndpoint(userId: string, endpoint: string, tx: TransactionContext): Promise<number>;
  /** Deletes every subscription created by this authentication session (and their deliveries). Idempotent. */
  deleteSubscriptionsBySession(sessionId: string, tx: TransactionContext): Promise<number>;
  deleteSubscription(subscriptionId: string, tx: TransactionContext): Promise<void>;
  recordSubscriptionSuccess(subscriptionId: string, now: Date, tx: TransactionContext): Promise<void>;
  /** Adds one consecutive failure and returns the new count. */
  recordSubscriptionFailure(subscriptionId: string, tx: TransactionContext): Promise<number>;

  // ---- push deliveries ----
  insertDeliveries(rows: readonly NewPushDelivery[], tx: TransactionContext): Promise<void>;
  /** Claims due PENDING deliveries (lock until `lockUntil`) and returns them with the data to send; deliveries whose notification or subscription is gone are removed. */
  claimDeliveries(params: ClaimParams): Promise<DeliveryForSend[]>;
  completeDelivery(deliveryId: string, tx: TransactionContext): Promise<void>;
  rescheduleDelivery(deliveryId: string, attempts: number, nextAttemptAt: Date, error: string, tx: TransactionContext): Promise<void>;
  failDelivery(deliveryId: string, attempts: number, error: string, now: Date, tx: TransactionContext): Promise<void>;
  /** Housekeeping: deletes FAILED deliveries older than the cut-off. Returns how many. */
  deleteFailedDeliveriesBefore(cutoff: Date): Promise<number>;
}
