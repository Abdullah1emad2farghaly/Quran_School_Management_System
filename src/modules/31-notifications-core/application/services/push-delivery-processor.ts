import { newUuid, type Clock, type UnitOfWork } from '../../../00-shared-kernel/public';
import { PUSH_LIMITS, pushPreview, pushRetryDelayMs } from '../../domain/value-objects/notification-rules';
import type { DeliveryForSend, NotificationRepository } from '../ports/notification-repository';
import type { PushSender } from '../ports/push-sender';
import type { RealtimeNotificationGateway } from '../ports/realtime-gateway';

/** How long a delivery for an ONLINE session waits for its real-time emission before falling back to Web Push. */
const DEFAULT_REALTIME_GRACE_MS = 6000;

export interface PushDeliveryProcessorDeps {
  readonly repository: NotificationRepository;
  readonly sender: PushSender;
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  /** Optional. A push is not sent to a session that already received the notification through its live connection (see `processDue`). */
  readonly realtime?: RealtimeNotificationGateway;
  readonly realtimeGraceMs?: number;
}

export interface PushPassResult {
  readonly sent: number;
  readonly retried: number;
  readonly failed: number;
  readonly subscriptionsRemoved: number;
}

/**
 * Sends the queued Web Push deliveries (Module 31). It runs OUTSIDE the transaction that created the notification, so a push problem can never lose or duplicate a
 * notification (the notification already exists; the outbox is not involved).
 *  - sent: the delivery row is removed and the subscription's failure count resets.
 *  - 404/410: that subscription (and its deliveries) is deleted. The account's other subscriptions are untouched.
 *  - temporary failure (network, 408, 429, 5xx): retried after 30 s, 60 s, 120 s, 240 s, then marked FAILED.
 *  - permanent rejection: marked FAILED at once. A subscription whose deliveries fail for good 5 times in a row is deleted.
 * Each result is applied in its own short transaction; failed rows are kept for 7 days and then removed.
 */
export class PushDeliveryProcessor {
  /** Counters for the logs (kept apart from `PushPassResult`, whose shape other code relies on). */
  readonly stats = { realtimeSkipped: 0, realtimeDeferred: 0 };

  constructor(private readonly deps: PushDeliveryProcessorDeps) {}

  /**
   * Real-time and Web Push complement each other PER DEVICE (a push subscription belongs to the authentication session that created it):
   *  - the session already received the notification through its live connection -> no push (the delivery row is removed);
   *  - the session is online but the notification is still younger than the grace period and was not emitted yet (it was created inside a caller's transaction) -> wait;
   *  - everything else (session offline, connection gone, emission never happened) -> the normal Web Push, exactly as before.
   */
  private route(item: DeliveryForSend, now: Date): 'send' | 'skip' | 'defer' {
    const gateway = this.deps.realtime;
    if (!gateway) return 'send';
    const { sessionId } = item.subscription;
    if (gateway.wasDeliveredToSession(sessionId, item.notification.id)) return 'skip';
    const graceMs = this.deps.realtimeGraceMs ?? DEFAULT_REALTIME_GRACE_MS;
    if (gateway.isSessionOnline(sessionId) && now.getTime() - item.notification.createdAt.getTime() < graceMs) return 'defer';
    return 'send';
  }

  async processDue(limit: number = PUSH_LIMITS.batchSize): Promise<PushPassResult> {
    const { repository, clock } = this.deps;
    const now = clock.now();
    const claimed = await repository.claimDeliveries({ claimId: newUuid(), now, lockUntil: new Date(now.getTime() + PUSH_LIMITS.claimLockMs), limit });
    const result = { sent: 0, retried: 0, failed: 0, subscriptionsRemoved: 0 };
    for (const item of claimed) {
      const route = this.route(item, clock.now());
      if (route === 'skip') {
        await this.deps.unitOfWork.run((tx) => repository.completeDelivery(item.deliveryId, tx));
        this.stats.realtimeSkipped += 1;
        continue;
      }
      if (route === 'defer') {
        const retryAt = new Date(clock.now().getTime() + 2000);
        await this.deps.unitOfWork.run((tx) => repository.rescheduleDelivery(item.deliveryId, item.attempts, retryAt, 'awaiting real-time delivery', tx));
        this.stats.realtimeDeferred += 1;
        continue;
      }
      const outcome = await this.send(item);
      const at = clock.now();
      await this.deps.unitOfWork.run(async (tx) => {
        if (outcome.kind === 'sent') {
          await repository.completeDelivery(item.deliveryId, tx);
          await repository.recordSubscriptionSuccess(item.subscription.id, at, tx);
          result.sent += 1;
          return;
        }
        if (outcome.kind === 'gone') {
          await repository.deleteSubscription(item.subscription.id, tx);
          result.subscriptionsRemoved += 1;
          return;
        }
        const attempts = item.attempts + 1;
        if (outcome.kind === 'retry' && attempts < PUSH_LIMITS.maxAttempts) {
          await repository.rescheduleDelivery(item.deliveryId, attempts, new Date(at.getTime() + pushRetryDelayMs(attempts)), outcome.error, tx);
          result.retried += 1;
          return;
        }
        await repository.failDelivery(item.deliveryId, attempts, outcome.error, at, tx);
        result.failed += 1;
        if ((await repository.recordSubscriptionFailure(item.subscription.id, tx)) >= PUSH_LIMITS.maxConsecutiveFailures) {
          await repository.deleteSubscription(item.subscription.id, tx);
          result.subscriptionsRemoved += 1;
        }
      });
    }
    await repository.deleteFailedDeliveriesBefore(new Date(clock.now().getTime() - PUSH_LIMITS.failedDeliveryRetentionDays * 24 * 3600 * 1000));
    return result;
  }

  private async send(item: DeliveryForSend) {
    const payload = JSON.stringify({ id: item.notification.id, type: item.notification.type, title: item.notification.title, body: pushPreview(item.notification.body) });
    try {
      return await this.deps.sender.send({ endpoint: item.subscription.endpoint, p256dh: item.subscription.p256dh, auth: item.subscription.auth }, payload);
    } catch {
      return { kind: 'retry', error: 'sender error' } as const; // a sender that throws is treated as a temporary failure; the error text is never kept (it could contain the endpoint)
    }
  }
}
