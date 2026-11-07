import { newUuid, type Clock, type UnitOfWork } from '../../../00-shared-kernel/public';
import { PUSH_LIMITS, pushPreview, pushRetryDelayMs } from '../../domain/value-objects/notification-rules';
import type { DeliveryForSend, NotificationRepository } from '../ports/notification-repository';
import type { PushSender } from '../ports/push-sender';

export interface PushDeliveryProcessorDeps {
  readonly repository: NotificationRepository;
  readonly sender: PushSender;
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
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
  constructor(private readonly deps: PushDeliveryProcessorDeps) {}

  async processDue(limit: number = PUSH_LIMITS.batchSize): Promise<PushPassResult> {
    const { repository, clock } = this.deps;
    const now = clock.now();
    const claimed = await repository.claimDeliveries({ claimId: newUuid(), now, lockUntil: new Date(now.getTime() + PUSH_LIMITS.claimLockMs), limit });
    const result = { sent: 0, retried: 0, failed: 0, subscriptionsRemoved: 0 };
    for (const item of claimed) {
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
