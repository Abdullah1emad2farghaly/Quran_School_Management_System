import webpush from 'web-push';
import type { PushSendOutcome, PushSender, PushTarget } from '../../application/ports/push-sender';
import { PUSH_LIMITS } from '../../domain/value-objects/notification-rules';

export interface VapidDetails {
  readonly subject: string;
  readonly publicKey: string;
  /** SECRET. Never logged or returned. */
  readonly privateKey: string;
}

/**
 * Sends Web Push with the Node `web-push` library (VAPID). The VAPID details are passed per call, so no global library state is touched. Only a short outcome code is ever
 * kept ("HTTP 503"): never the endpoint, the keys or the response body.
 */
export class WebPushSender implements PushSender {
  constructor(private readonly vapid: VapidDetails) {}

  async send(target: PushTarget, payload: string): Promise<PushSendOutcome> {
    try {
      await webpush.sendNotification({ endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } }, payload, {
        TTL: PUSH_LIMITS.ttlSeconds,
        timeout: 10_000,
        vapidDetails: { subject: this.vapid.subject, publicKey: this.vapid.publicKey, privateKey: this.vapid.privateKey },
      });
      return { kind: 'sent' };
    } catch (error) {
      const status = (error as { statusCode?: unknown } | null)?.statusCode;
      if (typeof status !== 'number') return { kind: 'retry', error: 'network error' };
      if (status === 404 || status === 410) return { kind: 'gone' };
      if (status === 408 || status === 429 || status >= 500) return { kind: 'retry', error: `HTTP ${status}` };
      return { kind: 'rejected', error: `HTTP ${status}` };
    }
  }
}
