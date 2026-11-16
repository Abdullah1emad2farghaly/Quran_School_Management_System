import { describe, expect, it } from 'vitest';
import { AppError } from '../../../src/modules/00-shared-kernel/public';
import {
  PUSH_LIMITS,
  PushDeliveryScheduler,
  createDeletePushSubscriptionsOnSessionRevokedHandler,
  isSafePushEndpoint,
  pushPreview,
  pushRetryDelayMs,
} from '../../../src/modules/31-notifications-core/public';
import { AUTH, P256DH, VAPID_PUBLIC_KEY, createNotificationHarness } from '../../helpers/notification-harness';

const ALICE = '11111111-1111-4111-8111-111111111111';
const BOB = '22222222-2222-4222-8222-222222222222';

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof AppError) return e.code;
    throw e;
  }
  return 'OK';
}
type H = ReturnType<typeof createNotificationHarness>;
const subsOf = (h: H, userId: string) => [...h.repository.subscriptions.values()].filter((s) => s.userId === userId);

describe('push endpoint safety (the server posts to this URL)', () => {
  it('accepts real push-service endpoints', () => {
    for (const e of [
      'https://fcm.googleapis.com/fcm/send/abc123',
      'https://updates.push.services.mozilla.com/wpush/v2/gAAAA',
      'https://web.push.apple.com/QGxk',
      'https://wns2-par02p.notify.windows.com/w/?token=abc',
    ]) {
      expect(isSafePushEndpoint(e), e).toBe(true);
    }
  });

  it('rejects anything that could point the server at an internal address', () => {
    for (const e of [
      'http://fcm.googleapis.com/x', // not https
      'https://127.0.0.1/x',
      'https://10.0.0.5/x',
      'https://169.254.169.254/latest/meta-data',
      'https://2130706433/x',
      'https://0x7f000001/x',
      'https://[::1]/x',
      'https://localhost/x',
      'https://intranet/x',
      'https://db.internal/x',
      'https://printer.local/x',
      'https://user:pass@fcm.googleapis.com/x',
      'https://fcm.googleapis.com:8443/x',
      'ftp://fcm.googleapis.com/x',
      'not a url',
      '',
      `https://fcm.googleapis.com/${'a'.repeat(2100)}`,
    ]) {
      expect(isSafePushEndpoint(e), e).toBe(false);
    }
    expect(isSafePushEndpoint(undefined)).toBe(false);
    expect(isSafePushEndpoint(42)).toBe(false);
  });
});

describe('push subscriptions', () => {
  it('gives the VAPID public key, or PUSH_NOT_CONFIGURED when push is disabled', async () => {
    expect(createNotificationHarness().push.publicKey()).toBe(VAPID_PUBLIC_KEY);
    const off = createNotificationHarness({ pushEnabled: false });
    expect(() => off.push.publicKey()).toThrow();
    expect(await codeOf(off.subscribe(ALICE, 's1', 'x'))).toBe('PUSH_NOT_CONFIGURED');
  });

  it('stores a subscription for the account and the session that created it, and is idempotent for the same endpoint', async () => {
    const h = createNotificationHarness();
    const first = await h.subscribe(ALICE, 'session-1', 'phone');
    const again = await h.subscribe(ALICE, 'session-1', 'phone');
    expect(again.id).toBe(first.id);
    expect(first.isCurrentSession).toBe(true);
    expect(subsOf(h, ALICE)).toHaveLength(1);
    expect(subsOf(h, ALICE)[0]).toMatchObject({ userId: ALICE, sessionId: 'session-1', endpoint: h.endpoint('phone'), p256dh: P256DH, auth: AUTH });
  });

  it('lets one account have several subscriptions (several devices)', async () => {
    const h = createNotificationHarness();
    await h.subscribe(ALICE, 's1', 'phone');
    await h.subscribe(ALICE, 's2', 'laptop');
    await h.subscribe(ALICE, 's3', 'tablet');
    expect(subsOf(h, ALICE)).toHaveLength(3);
  });

  it('rejects invalid endpoints and keys with INVALID_PUSH_SUBSCRIPTION', async () => {
    const h = createNotificationHarness();
    const base = { endpoint: h.endpoint('x'), p256dh: P256DH, auth: AUTH };
    expect(await codeOf(h.push.subscribe(ALICE, 's', { ...base, endpoint: 'http://push.example.com/x' }))).toBe('INVALID_PUSH_SUBSCRIPTION');
    expect(await codeOf(h.push.subscribe(ALICE, 's', { ...base, endpoint: 'https://127.0.0.1/x' }))).toBe('INVALID_PUSH_SUBSCRIPTION');
    expect(await codeOf(h.push.subscribe(ALICE, 's', { ...base, endpoint: 42 }))).toBe('INVALID_PUSH_SUBSCRIPTION');
    expect(await codeOf(h.push.subscribe(ALICE, 's', { ...base, p256dh: 'short' }))).toBe('INVALID_PUSH_SUBSCRIPTION');
    expect(await codeOf(h.push.subscribe(ALICE, 's', { ...base, auth: 'has spaces and !!' }))).toBe('INVALID_PUSH_SUBSCRIPTION');
    expect(await codeOf(h.push.subscribe(ALICE, 's', { ...base, auth: undefined }))).toBe('INVALID_PUSH_SUBSCRIPTION');
    expect(h.repository.subscriptions.size).toBe(0);
  });

  it('applies the protective cap per account, but still lets an existing endpoint refresh', async () => {
    const h = createNotificationHarness();
    for (let i = 0; i < PUSH_LIMITS.maxSubscriptionsPerAccount; i += 1) await h.subscribe(ALICE, `s${i}`, `device-${i}`);
    expect(await codeOf(h.subscribe(ALICE, 's-new', 'one-too-many'))).toBe('PUSH_SUBSCRIPTION_LIMIT_REACHED');
    expect(await codeOf(h.subscribe(ALICE, 's-new', 'device-3'))).toBe('OK');
    expect(await codeOf(h.subscribe(BOB, 's-b', 'bobs-device'))).toBe('OK'); // the cap is per account
  });

  it('moves an endpoint to the new account and drops what was queued for the previous one', async () => {
    const h = createNotificationHarness();
    await h.subscribe(ALICE, 'session-a', 'shared-browser');
    await h.service.notify(h.examInput([ALICE]));
    expect(h.repository.deliveries.size).toBe(1);

    const moved = await h.subscribe(BOB, 'session-b', 'shared-browser');
    expect(moved.isCurrentSession).toBe(true);
    expect(subsOf(h, ALICE)).toHaveLength(0);
    expect(subsOf(h, BOB)).toHaveLength(1);
    expect(h.repository.deliveries.size).toBe(0); // Alice's pending push never reaches Bob's browser
    await h.processor.processDue();
    expect(h.sender.sent).toHaveLength(0);
  });

  it('lists only safe fields of the caller\'s own subscriptions', async () => {
    const h = createNotificationHarness();
    await h.subscribe(ALICE, 'session-1', 'phone');
    await h.subscribe(ALICE, 'session-2', 'laptop');
    await h.subscribe(BOB, 'session-3', 'bob');
    const list = await h.push.list(ALICE, 'session-2');
    expect(list).toHaveLength(2);
    expect(list.map((s) => s.isCurrentSession)).toEqual([false, true]);
    for (const s of list) expect(Object.keys(s).sort()).toEqual(['createdAt', 'id', 'isCurrentSession', 'lastSuccessAt']);
    expect(JSON.stringify(list)).not.toContain('push.example.com');
    expect(JSON.stringify(list)).not.toContain(P256DH);
  });

  it('unsubscribe removes only the caller\'s subscription with that endpoint and never touches notifications', async () => {
    const h = createNotificationHarness();
    await h.subscribe(ALICE, 's1', 'phone');
    await h.subscribe(ALICE, 's2', 'laptop');
    await h.subscribe(BOB, 's3', 'bob');
    await h.service.notify(h.examInput([ALICE]));

    await h.push.unsubscribe(BOB, h.endpoint('phone')); // not Bob's: nothing happens
    expect(subsOf(h, ALICE)).toHaveLength(2);
    await h.push.unsubscribe(ALICE, h.endpoint('phone'));
    expect(subsOf(h, ALICE).map((s) => s.endpoint)).toEqual([h.endpoint('laptop')]);
    await h.push.unsubscribe(ALICE, h.endpoint('phone')); // idempotent
    expect(h.repository.notifications.size).toBe(1);
    expect(h.repository.deliveries.size).toBe(1); // the laptop's delivery stays
    expect(await codeOf(h.push.unsubscribe(ALICE, ''))).toBe('INVALID_PUSH_SUBSCRIPTION');
  });
});

describe('session end deletes only that session\'s subscriptions (decisions Q3 and Q5)', () => {
  it('deletes the subscriptions created by the revoked session and keeps other sessions\' ones and every notification', async () => {
    const h = createNotificationHarness();
    await h.subscribe(ALICE, 'session-1', 'phone');
    await h.subscribe(ALICE, 'session-2', 'laptop');
    await h.subscribe(BOB, 'session-3', 'bob');
    await h.service.notify(h.examInput([ALICE, BOB]));

    expect(await h.push.deleteForSession('session-1')).toBe(1);
    expect(subsOf(h, ALICE).map((s) => s.sessionId)).toEqual(['session-2']);
    expect(subsOf(h, BOB)).toHaveLength(1);
    expect(h.repository.notifications.size).toBe(2); // account notifications are never deleted
    expect([...h.repository.deliveries.values()].every((d) => d.subscriptionId !== undefined && h.repository.subscriptions.has(d.subscriptionId))).toBe(true);
    expect(await h.push.deleteForSession('session-1')).toBe(0); // idempotent
    expect(await h.push.deleteForSession('unknown')).toBe(0);
  });

  it('the AuthSessionRevoked handler does this for every reason and ignores malformed events', async () => {
    const h = createNotificationHarness();
    const handler = createDeletePushSubscriptionsOnSessionRevokedHandler(h.push);
    expect(handler.eventTypes).toEqual(['AuthSessionRevoked']);
    for (const reason of ['LOGOUT', 'LOGOUT_ALL', 'DEVICE_REVOKED', 'PASSWORD_CHANGED', 'PASSWORD_RESET', 'USER_DEACTIVATED', 'REFRESH_TOKEN_REUSE', 'SESSION_EXPIRED']) {
      await h.subscribe(ALICE, `session-${reason}`, `device-${reason}`);
      await h.subscribe(ALICE, 'session-keep', 'keep-device');
      await handler.handle({ payload: { sessionId: `session-${reason}`, userId: ALICE, reason } } as never);
      expect(subsOf(h, ALICE).map((s) => s.sessionId), reason).toEqual(['session-keep']);
    }
    await handler.handle({ payload: null } as never);
    await handler.handle({ payload: { sessionId: '' } } as never);
    await handler.handle({ payload: { sessionId: 42 } } as never);
    expect(subsOf(h, ALICE)).toHaveLength(1);
  });
});

describe('push delivery', () => {
  async function setup(h: H, subscriptions = ['phone']) {
    for (const [i, name] of subscriptions.entries()) await h.subscribe(ALICE, `session-${i}`, name);
    await h.service.notify(h.examInput([ALICE]));
  }

  it('sends the title and a short preview only, then removes the delivery and records the success', async () => {
    const h = createNotificationHarness();
    await setup(h);
    const result = await h.processor.processDue();
    expect(result).toEqual({ sent: 1, retried: 0, failed: 0, subscriptionsRemoved: 0 });
    expect(h.repository.deliveries.size).toBe(0);
    expect(subsOf(h, ALICE)[0]!.lastSuccessAt).toEqual(h.clock.now());

    const payload = JSON.parse(h.sender.sent[0]!.payload);
    expect(Object.keys(payload).sort()).toEqual(['body', 'id', 'title', 'type']);
    expect(payload.title).toBe('نتيجة اختبار Ali');
    expect(h.sender.sent[0]!.payload).not.toContain('exam-1'); // the data object is not part of the push
    expect(h.sender.sent[0]!.target.endpoint).toBe(h.endpoint('phone'));
  });

  it('delivers to every active subscription of the account', async () => {
    const h = createNotificationHarness();
    await setup(h, ['phone', 'laptop', 'tablet']);
    const result = await h.processor.processDue();
    expect(result.sent).toBe(3);
    expect(h.sender.sent.map((s) => s.target.endpoint).sort()).toEqual([h.endpoint('laptop'), h.endpoint('phone'), h.endpoint('tablet')]);
  });

  it('cuts a long body to a short preview', () => {
    expect(pushPreview('x'.repeat(1000))).toHaveLength(PUSH_LIMITS.pushBodyMax);
    expect(pushPreview('short')).toBe('short');
  });

  it('removes only a subscription the push service reports gone (404/410); the others are still served', async () => {
    const h = createNotificationHarness();
    await setup(h, ['gone-phone', 'laptop']);
    h.sender.outcome = (t) => (t.endpoint === h.endpoint('gone-phone') ? { kind: 'gone' } : { kind: 'sent' });
    const result = await h.processor.processDue();
    expect(result).toMatchObject({ sent: 1, subscriptionsRemoved: 1 });
    expect(subsOf(h, ALICE).map((s) => s.endpoint)).toEqual([h.endpoint('laptop')]);
    expect(h.repository.notifications.size).toBe(1); // the notification is never touched
    expect(h.repository.deliveries.size).toBe(0);
  });

  it('retries a temporary failure after 30 s, 60 s, 120 s and 240 s, then marks it failed', async () => {
    const h = createNotificationHarness();
    await setup(h);
    h.sender.outcome = () => ({ kind: 'retry', error: 'HTTP 503' });
    const delivery = () => [...h.repository.deliveries.values()][0]!;

    for (const [attempt, delay] of [[1, 30_000], [2, 60_000], [3, 120_000], [4, 240_000]] as const) {
      const start = h.clock.now().getTime();
      expect(await h.processor.processDue()).toMatchObject({ retried: 1 });
      expect(delivery().attempts).toBe(attempt);
      expect(delivery().nextAttemptAt.getTime() - start).toBe(delay);
      expect(pushRetryDelayMs(attempt)).toBe(delay);
      expect(await h.processor.processDue()).toMatchObject({ sent: 0, retried: 0, failed: 0 }); // not due yet
      h.advance(delay);
    }
    expect(await h.processor.processDue()).toMatchObject({ failed: 1 });
    expect(delivery()).toMatchObject({ status: 'FAILED', attempts: 5, lastError: 'HTTP 503' });
    expect(h.repository.notifications.size).toBe(1);
    expect(h.sender.sent).toHaveLength(5);
    h.advance(10 * 60_000);
    expect(await h.processor.processDue()).toMatchObject({ sent: 0 }); // a failed delivery is never retried
  });

  it('rejects a permanent failure at once without retrying', async () => {
    const h = createNotificationHarness();
    await setup(h);
    h.sender.outcome = () => ({ kind: 'rejected', error: 'HTTP 400' });
    expect(await h.processor.processDue()).toMatchObject({ failed: 1, retried: 0 });
    expect([...h.repository.deliveries.values()][0]).toMatchObject({ status: 'FAILED', attempts: 1 });
  });

  it('removes a subscription after 5 consecutive failed deliveries, but not after a success in between', async () => {
    const h = createNotificationHarness();
    await h.subscribe(ALICE, 'session-0', 'flaky');
    h.sender.outcome = () => ({ kind: 'rejected', error: 'HTTP 400' });
    for (let i = 0; i < 4; i += 1) {
      await h.service.notify(h.examInput([ALICE]));
      await h.processor.processDue();
    }
    expect(subsOf(h, ALICE)[0]!.consecutiveFailures).toBe(4);
    h.sender.outcome = () => ({ kind: 'sent' });
    await h.service.notify(h.examInput([ALICE]));
    await h.processor.processDue();
    expect(subsOf(h, ALICE)[0]!.consecutiveFailures).toBe(0); // a success resets the count

    h.sender.outcome = () => ({ kind: 'rejected', error: 'HTTP 400' });
    for (let i = 0; i < 5; i += 1) {
      await h.service.notify(h.examInput([ALICE]));
      await h.processor.processDue();
    }
    expect(subsOf(h, ALICE)).toHaveLength(0);
    expect(h.repository.notifications.size).toBe(10); // every notification is still there
  });

  it('treats a sender that throws as a temporary failure and never stores its message', async () => {
    const h = createNotificationHarness();
    await setup(h);
    h.sender.throwError = true;
    expect(await h.processor.processDue()).toMatchObject({ retried: 1 });
    const d = [...h.repository.deliveries.values()][0]!;
    expect(d.lastError).toBe('sender error');
    expect(JSON.stringify([...h.repository.deliveries.values()])).not.toContain('push.example.com');
  });

  it('never sends a push for a notification that was deleted meanwhile', async () => {
    const h = createNotificationHarness();
    await setup(h);
    await h.service.clearAll(ALICE);
    expect(await h.processor.processDue()).toEqual({ sent: 0, retried: 0, failed: 0, subscriptionsRemoved: 0 });
    expect(h.sender.sent).toHaveLength(0);
  });

  it('claims each delivery once: two passes at the same time do not send twice', async () => {
    const h = createNotificationHarness();
    await setup(h);
    let release: (() => void) | undefined;
    h.sender.outcome = () => new Promise((resolve) => { release = () => resolve({ kind: 'sent' }); });
    const first = h.processor.processDue();
    await Promise.resolve();
    await Promise.resolve();
    const second = await h.processor.processDue(); // claims nothing: the delivery is locked by the first pass
    expect(second.sent).toBe(0);
    release?.();
    expect((await first).sent).toBe(1);
    expect(h.sender.sent).toHaveLength(1);
  });

  it('does not queue or send anything for an account without subscriptions, and removes old failed deliveries after 7 days', async () => {
    const h = createNotificationHarness();
    await h.service.notify(h.examInput([BOB]));
    expect(h.repository.deliveries.size).toBe(0);

    await setup(h);
    h.sender.outcome = () => ({ kind: 'rejected', error: 'HTTP 400' });
    await h.processor.processDue();
    expect(h.repository.deliveries.size).toBe(1);
    h.advance(8 * 24 * 3600 * 1000);
    await h.processor.processDue();
    expect(h.repository.deliveries.size).toBe(0);
  });
});

describe('PushDeliveryScheduler', () => {
  it('runs a pass, never overlaps and survives an error', async () => {
    let calls = 0;
    let release: (() => void) | undefined;
    const errors: unknown[] = [];
    const results: unknown[] = [];
    const scheduler = new PushDeliveryScheduler({
      job: {
        processDue: () => {
          calls += 1;
          if (calls === 1) return new Promise((resolve) => { release = () => resolve({ sent: 2, retried: 0, failed: 0, subscriptionsRemoved: 0 }); });
          if (calls === 2) return Promise.reject(new Error('boom'));
          return Promise.resolve({ sent: 0, retried: 0, failed: 0, subscriptionsRemoved: 0 });
        },
      },
      onError: (e) => errors.push(e),
      onResult: (r) => results.push(r),
    });
    const first = scheduler.tick();
    expect(await scheduler.tick()).toBe(false);
    release?.();
    expect(await first).toBe(true);
    expect(results).toHaveLength(1);
    expect(await scheduler.tick()).toBe(true);
    expect(errors).toHaveLength(1);
    expect(await scheduler.tick()).toBe(true);
    expect(results).toHaveLength(1); // an idle pass reports nothing
    scheduler.stop();
  });
});
