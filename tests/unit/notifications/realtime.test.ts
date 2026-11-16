import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DomainEvent, TransactionContext, UnitOfWork } from '../../../src/modules/00-shared-kernel/public';
import {
  InMemoryNotificationRepository,
  NotificationService,
  NotificationTemplateRegistry,
  PushDeliveryProcessor,
  PushSubscriptionService,
  createDisconnectSocketsOnSessionRevokedHandler,
  noAccountLanguage,
  type NotificationDto,
  type RealtimeNotificationGateway,
} from '../../../src/modules/31-notifications-core/public';
import { AUTH, EXAM_TEMPLATE, FakePushSender, P256DH } from '../../helpers/notification-harness';

const ALICE = '11111111-1111-4111-8111-111111111111';
const BOB = '22222222-2222-4222-8222-222222222222';
const tx = {} as TransactionContext;

/** An in-memory stand-in for the Socket.IO gateway: the test decides which sessions are online; it records what was emitted. */
class FakeGateway implements RealtimeNotificationGateway {
  readonly online = new Map<string, string>(); // sessionId -> userId
  readonly published: Array<{ userId: string; notification: NotificationDto }> = [];
  readonly delivered = new Set<string>(); // `${sessionId}|${notificationId}`
  failOnPublish = false;
  isUserOnline = (userId: string) => [...this.online.values()].includes(userId);
  isSessionOnline = (sessionId: string) => this.online.has(sessionId);
  publishNotification(userId: string, notification: NotificationDto): readonly string[] {
    if (this.failOnPublish) throw new Error('socket exploded');
    const sessions = [...this.online].filter(([, u]) => u === userId).map(([s]) => s);
    if (sessions.length === 0) return [];
    this.published.push({ userId, notification });
    for (const s of sessions) this.delivered.add(`${s}|${notification.id}`);
    return sessions;
  }
  wasDeliveredToSession = (sessionId: string, notificationId: string) => this.delivered.has(`${sessionId}|${notificationId}`);
}

function setup() {
  let current = new Date('2026-11-16T09:00:00Z');
  const clock = { now: () => current };
  const advance = (ms: number) => (current = new Date(current.getTime() + ms));
  const repository = new InMemoryNotificationRepository();
  const unitOfWork: UnitOfWork = { run: (work) => work(tx) };
  const templates = new NotificationTemplateRegistry();
  templates.register(EXAM_TEMPLATE);
  const gateway = new FakeGateway();
  const errors: unknown[] = [];
  const service = new NotificationService({
    repository, unitOfWork, clock, templates, language: noAccountLanguage, pushEnabled: true, realtime: gateway, onRealtimeError: (e) => errors.push(e),
  });
  const push = new PushSubscriptionService({ repository, unitOfWork, clock, pushEnabled: true, vapidPublicKey: 'k' });
  const sender = new FakePushSender();
  const processor = new PushDeliveryProcessor({ repository, sender, unitOfWork, clock, realtime: gateway });
  const input = (recipients: string[], dedupKey: string) => ({ recipientUserIds: recipients, templateKey: EXAM_TEMPLATE.key, params: { student: 'Ali', score: 18, max: 20 }, dedupKey });
  const endpoint = (name: string) => `https://push.example.com/send/${name}`;
  const subscribe = (userId: string, sessionId: string, name: string) => push.subscribe(userId, sessionId, { endpoint: endpoint(name), p256dh: P256DH, auth: AUTH });
  return { clock, advance, repository, service, gateway, sender, processor, input, endpoint, subscribe, errors };
}

afterEach(() => vi.useRealTimers());

describe('real-time emission', () => {
  it('stores the notification first, then emits it to an online account (same shape as the notification API)', async () => {
    const h = setup();
    h.gateway.online.set('s-desktop', ALICE);
    const result = await h.service.notify(h.input([ALICE], 'k1'));
    expect(result.created).toEqual([ALICE]);
    expect(h.gateway.published).toHaveLength(1);
    const emitted = h.gateway.published[0]!;
    expect(emitted.userId).toBe(ALICE);
    expect(Object.keys(emitted.notification).sort()).toEqual(['body', 'createdAt', 'data', 'id', 'readAt', 'title', 'type']);
    expect(h.repository.notifications.get(emitted.notification.id)?.recipientUserId).toBe(ALICE);
  });

  it('emits nothing for an offline account and for a duplicate (once-only) key', async () => {
    const h = setup();
    await h.service.notify(h.input([ALICE], 'k1'));
    expect(h.gateway.published).toHaveLength(0);
    h.gateway.online.set('s1', ALICE);
    await h.service.notify(h.input([ALICE], 'k2'));
    await h.service.notify(h.input([ALICE], 'k2'));
    expect(h.gateway.published).toHaveLength(1);
  });

  it('never delivers one account\'s notification to another account', async () => {
    const h = setup();
    h.gateway.online.set('s-alice', ALICE);
    h.gateway.online.set('s-bob', BOB);
    await h.service.notify(h.input([BOB], 'k1'));
    expect(h.gateway.published.map((p) => p.userId)).toEqual([BOB]);
  });

  it('a failing socket never fails or loses the notification', async () => {
    const h = setup();
    h.gateway.online.set('s1', ALICE);
    h.gateway.failOnPublish = true;
    const result = await h.service.notify(h.input([ALICE], 'k1'));
    expect(result.created).toEqual([ALICE]);
    expect(h.repository.notifications.size).toBe(1);
    expect(h.errors).toHaveLength(1);
  });

  it('inside a caller\'s transaction it emits only once the row is visible, and only for online accounts', async () => {
    vi.useFakeTimers();
    const h = setup();
    h.gateway.online.set('s1', ALICE);
    const find = vi.spyOn(h.repository, 'findNotification');
    await h.service.notify(h.input([ALICE, BOB], 'k1'), tx);
    expect(h.gateway.published).toHaveLength(0); // not emitted synchronously
    await vi.advanceTimersByTimeAsync(100);
    expect(h.gateway.published.map((p) => p.userId)).toEqual([ALICE]);
    expect(find).toHaveBeenCalledTimes(1); // Bob is offline: no database lookup for him
  });

  it('a rolled-back notification (never visible) is never emitted', async () => {
    vi.useFakeTimers();
    const h = setup();
    h.gateway.online.set('s1', ALICE);
    await h.service.notify(h.input([ALICE], 'k1'), tx);
    h.repository.notifications.clear(); // the caller's transaction rolled back
    await vi.advanceTimersByTimeAsync(6000);
    expect(h.gateway.published).toHaveLength(0);
  });
});

describe('Web Push and real-time together (per device)', () => {
  it('pushes only to the device without a live connection; the connected device gets no duplicate', async () => {
    const h = setup();
    await h.subscribe(ALICE, 's-desktop', 'desktop');
    await h.subscribe(ALICE, 's-mobile', 'mobile');
    h.gateway.online.set('s-desktop', ALICE); // desktop online, mobile offline
    await h.service.notify(h.input([ALICE], 'k1'));
    const pass = await h.processor.processDue();
    expect(h.sender.sent.map((s) => s.target.endpoint)).toEqual([h.endpoint('mobile')]);
    expect(pass.sent).toBe(1);
    expect(h.processor.stats.realtimeSkipped).toBe(1);
    expect(h.repository.deliveries.size).toBe(0);
  });

  it('an offline account still gets the normal Web Push on every device', async () => {
    const h = setup();
    await h.subscribe(ALICE, 's-desktop', 'desktop');
    await h.subscribe(ALICE, 's-mobile', 'mobile');
    await h.service.notify(h.input([ALICE], 'k1'));
    await h.processor.processDue();
    expect(h.sender.sent.map((s) => s.target.endpoint).sort()).toEqual([h.endpoint('desktop'), h.endpoint('mobile')].sort());
  });

  it('a session that is online but was NOT reached waits briefly, then falls back to push (nothing is lost)', async () => {
    const h = setup();
    await h.subscribe(ALICE, 's-desktop', 'desktop');
    await h.service.notify(h.input([ALICE], 'k1')); // created while offline
    h.gateway.online.set('s-desktop', ALICE); // connected afterwards: no emission happened for it
    await h.processor.processDue();
    expect(h.sender.sent).toHaveLength(0);
    expect(h.processor.stats.realtimeDeferred).toBe(1);
    expect(h.repository.deliveries.size).toBe(1); // still queued
    h.advance(10_000); // grace period over
    await h.processor.processDue();
    expect(h.sender.sent.map((s) => s.target.endpoint)).toEqual([h.endpoint('desktop')]);
  });

  it('without a gateway the push behavior is exactly the previous one', async () => {
    const h = setup();
    const plain = new PushDeliveryProcessor({ repository: h.repository, sender: h.sender, unitOfWork: { run: (w) => w(tx) }, clock: h.clock });
    await h.subscribe(ALICE, 's1', 'one');
    await h.service.notify(h.input([ALICE], 'k1'));
    expect(await plain.processDue()).toEqual({ sent: 1, retried: 0, failed: 0, subscriptionsRemoved: 0 });
  });
});

describe('closing connections when a session ends', () => {
  it('disconnects that session only, and ignores malformed events', async () => {
    const closed: string[] = [];
    const handler = createDisconnectSocketsOnSessionRevokedHandler({ disconnectSession: (id) => closed.push(id) });
    expect(handler.eventTypes).toEqual(['AuthSessionRevoked']);
    await handler.handle({ payload: { sessionId: 's-1' } } as unknown as DomainEvent);
    await handler.handle({ payload: null } as unknown as DomainEvent);
    await handler.handle({ payload: { sessionId: '' } } as unknown as DomainEvent);
    expect(closed).toEqual(['s-1']);
  });
});
