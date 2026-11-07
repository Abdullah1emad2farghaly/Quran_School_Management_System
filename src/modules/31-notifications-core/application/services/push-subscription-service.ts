import { newUuid, type Clock, type UnitOfWork } from '../../../00-shared-kernel/public';
import { notificationError } from '../../domain/errors/notification-errors';
import { PUSH_LIMITS } from '../../domain/value-objects/notification-rules';
import { isPushKey, isSafePushEndpoint } from '../../domain/value-objects/push-endpoint';
import type { PushSubscriptionDto, PushSubscriptionInput } from '../dto/notification-dto';
import type { NotificationRepository } from '../ports/notification-repository';

export interface PushSubscriptionServiceDeps {
  readonly repository: NotificationRepository;
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  /** True only when the VAPID keys are configured. */
  readonly pushEnabled: boolean;
  /** The VAPID PUBLIC key (the one browsers need). Empty when push is disabled. */
  readonly vapidPublicKey: string;
}

/**
 * Web Push subscriptions (approved Module 31 decisions). A subscription belongs to a browser/device endpoint, is linked to the ACCOUNT and to the authentication
 * SESSION that created it, and is deleted when that session ends (`deleteForSession`, driven by Module 10's `AuthSessionRevoked`). An account may have several.
 * Notifications are never touched here.
 */
export class PushSubscriptionService {
  constructor(private readonly deps: PushSubscriptionServiceDeps) {}

  /** The public VAPID key a browser needs to subscribe. */
  publicKey(): string {
    this.requireEnabled();
    return this.deps.vapidPublicKey;
  }

  /**
   * Registers (or refreshes) the caller's push subscription for the session that made the request. Subscribing again with the same endpoint is idempotent. An endpoint
   * that belonged to another account moves to this one and its pending deliveries for the old account are dropped.
   */
  async subscribe(userId: string, sessionId: string, input: PushSubscriptionInput): Promise<PushSubscriptionDto> {
    this.requireEnabled();
    if (!isSafePushEndpoint(input.endpoint) || !isPushKey(input.p256dh) || !isPushKey(input.auth)) throw notificationError('INVALID_PUSH_SUBSCRIPTION');
    const { endpoint, p256dh, auth } = { endpoint: input.endpoint, p256dh: input.p256dh, auth: input.auth };
    const now = this.deps.clock.now();
    const saved = await this.deps.unitOfWork.run(async (tx) => {
      const others = await this.deps.repository.countSubscriptionsExcludingEndpoint(userId, endpoint, tx);
      if (others >= PUSH_LIMITS.maxSubscriptionsPerAccount) {
        throw notificationError('PUSH_SUBSCRIPTION_LIMIT_REACHED', { maxSubscriptions: PUSH_LIMITS.maxSubscriptionsPerAccount });
      }
      return this.deps.repository.upsertSubscription({ id: newUuid(), userId, sessionId, endpoint, p256dh, auth, createdAt: now }, tx);
    });
    return { id: saved.id, createdAt: saved.createdAt, lastSuccessAt: saved.lastSuccessAt, isCurrentSession: saved.sessionId === sessionId };
  }

  /** Removes the caller's subscription with this endpoint (the browser unsubscribed, or the user logs out). Idempotent; never touches notifications or other subscriptions. */
  async unsubscribe(userId: string, endpoint: unknown): Promise<void> {
    if (typeof endpoint !== 'string' || endpoint === '' || endpoint.length > PUSH_LIMITS.endpointMax) throw notificationError('INVALID_PUSH_SUBSCRIPTION');
    await this.deps.unitOfWork.run((tx) => this.deps.repository.deleteSubscriptionByEndpoint(userId, endpoint, tx));
  }

  /** The caller's own subscriptions: ids and times only, never the endpoint or the keys. */
  async list(userId: string, currentSessionId: string): Promise<PushSubscriptionDto[]> {
    const subs = await this.deps.repository.listSubscriptionsOfUser(userId);
    return subs.map((s) => ({ id: s.id, createdAt: s.createdAt, lastSuccessAt: s.lastSuccessAt, isCurrentSession: s.sessionId === currentSessionId }));
  }

  /**
   * Deletes ONLY the subscriptions created by this authentication session (and their pending deliveries). Called when the session ends for any reason. Idempotent,
   * and it never deletes a notification or a subscription of another session.
   */
  async deleteForSession(sessionId: string): Promise<number> {
    return this.deps.unitOfWork.run((tx) => this.deps.repository.deleteSubscriptionsBySession(sessionId, tx));
  }

  private requireEnabled(): void {
    if (!this.deps.pushEnabled) throw notificationError('PUSH_NOT_CONFIGURED');
  }
}
