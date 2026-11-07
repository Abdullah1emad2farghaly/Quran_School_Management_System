import { describe, expect, it } from 'vitest';
import { AppError } from '../../../src/modules/00-shared-kernel/public';
import {
  DEFAULT_NOTIFICATION_LOCALE,
  NOTIFICATION_LIMITS,
  NotificationDefinitionError,
  NotificationTemplateRegistry,
} from '../../../src/modules/31-notifications-core/public';
import { EXAM_TEMPLATE, createNotificationHarness } from '../../helpers/notification-harness';

const ALICE = '11111111-1111-4111-8111-111111111111';
const BOB = '22222222-2222-4222-8222-222222222222';
const PAGE = { page: 1, pageSize: 20 };
const listQuery = (filters: Record<string, string | number | boolean> = {}, direction: 'asc' | 'desc' = 'desc', page = PAGE) =>
  ({ page, sort: [{ key: 'createdAt', direction }], filters }) as never;

async function rejection(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
  } catch (e) {
    return e;
  }
  return undefined;
}
const mine = (h: ReturnType<typeof createNotificationHarness>, userId: string) => [...h.repository.notifications.values()].filter((n) => n.recipientUserId === userId);

describe('notification templates', () => {
  const ok = { key: 'a.b', type: 'SOME_TYPE', title: { ar: 'عنوان', en: 'Title' }, body: { ar: 'نص', en: 'Body' } };

  it('requires an Arabic AND an English title and body, a valid key and type, and a unique key', () => {
    const r = new NotificationTemplateRegistry();
    r.register(ok);
    expect(r.has('a.b')).toBe(true);
    expect(() => r.register(ok)).toThrow();
    expect(() => r.register({ ...ok, key: 'x1', title: { ar: 'عنوان', en: '  ' } })).toThrow();
    expect(() => r.register({ ...ok, key: 'x2', body: { ar: '', en: 'Body' } })).toThrow();
    expect(() => r.register({ ...ok, key: 'Bad Key' })).toThrow();
    expect(() => r.register({ ...ok, key: 'x3', type: 'lower_case' })).toThrow();
    expect(() => r.register({ ...ok, key: 'x4', title: { ar: 'عنوان' } as never })).toThrow(NotificationDefinitionError);
  });
});

describe('notify: one notification per recipient ACCOUNT', () => {
  it('creates one notification per distinct recipient, rendered in Arabic by default, and persists the rendered text', async () => {
    const h = createNotificationHarness();
    const result = await h.service.notify(h.examInput([ALICE, BOB, ALICE]));
    expect(result.created).toEqual([ALICE, BOB]);
    expect(result.duplicates).toEqual([]);

    expect(DEFAULT_NOTIFICATION_LOCALE).toBe('ar');
    const [n] = mine(h, ALICE);
    expect(mine(h, ALICE)).toHaveLength(1);
    expect(mine(h, BOB)).toHaveLength(1);
    expect(n!.type).toBe('EXAM_RESULT_RECORDED');
    expect(n!.title).toBe('نتيجة اختبار Ali');
    expect(n!.body).toBe('حصل Ali على 18 من 20.');
    expect(n!.readAt).toBeNull();
    expect(JSON.parse(n!.data!)).toEqual({ examId: 'exam-1' });
    expect(n!.createdAt).toEqual(h.clock.now());
  });

  it('uses the account language when one is configured, falls back to Arabic for none or an unknown value', async () => {
    const h = createNotificationHarness({ language: { languageOf: async (id) => (id === BOB ? 'en' : id === 'x' ? ('fr' as never) : undefined) } });
    await h.service.notify(h.examInput([ALICE, BOB, 'x']));
    expect(mine(h, BOB)[0]!.title).toBe('Exam result for Ali');
    expect(mine(h, BOB)[0]!.body).toBe('Ali scored 18 out of 20.');
    expect(mine(h, ALICE)[0]!.title).toBe('نتيجة اختبار Ali');
    expect(mine(h, 'x')[0]!.title).toBe('نتيجة اختبار Ali');
  });

  it('keeps the original language and text when the account language changes later', async () => {
    const h = createNotificationHarness();
    await h.service.notify(h.examInput([BOB]));
    const before = { ...mine(h, BOB)[0]! };
    h.language.resolver = { languageOf: async () => 'en' };
    await h.service.notify(h.examInput([BOB]));
    const all = mine(h, BOB).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.title.localeCompare(b.title));
    expect(all).toHaveLength(2);
    const arabic = all.find((n) => n.id === before.id)!;
    expect(arabic.title).toBe(before.title);
    expect(arabic.body).toBe(before.body);
    expect(all.find((n) => n.id !== before.id)!.title).toBe('Exam result for Ali');
  });

  it('cuts text that is too long instead of failing', async () => {
    const h = createNotificationHarness();
    await h.service.notify({ ...h.examInput([ALICE]), params: { student: 'x'.repeat(500), score: 1, max: 2 } });
    const n = mine(h, ALICE)[0]!;
    expect(n.title.length).toBe(NOTIFICATION_LIMITS.titleMax);
    expect(n.title.endsWith('…')).toBe(true);
  });

  it('is a no-op for an empty recipient list and rejects caller mistakes', async () => {
    const h = createNotificationHarness();
    expect(await h.service.notify(h.examInput([]))).toEqual({ created: [], duplicates: [] });
    expect(h.repository.notifications.size).toBe(0);

    const base = h.examInput([ALICE]);
    expect(await rejection(h.service.notify({ ...base, templateKey: 'nope' }))).toBeInstanceOf(NotificationDefinitionError);
    expect(await rejection(h.service.notify({ ...base, dedupKey: '' }))).toBeInstanceOf(NotificationDefinitionError);
    expect(await rejection(h.service.notify({ ...base, dedupKey: 'k'.repeat(192) }))).toBeInstanceOf(NotificationDefinitionError);
    expect(await rejection(h.service.notify({ ...base, data: { big: 'x'.repeat(5000) } }))).toBeInstanceOf(NotificationDefinitionError);
    expect(await rejection(h.service.notify({ ...base, params: { a: {} as never } }))).toBeInstanceOf(NotificationDefinitionError);
    expect(await rejection(h.service.notify({ ...base, recipientUserIds: Array.from({ length: 1001 }, (_, i) => `u${i}`) }))).toBeInstanceOf(NotificationDefinitionError);
    expect(h.repository.notifications.size).toBe(0);
  });

  it('joins the transaction of the caller when one is given', async () => {
    const h = createNotificationHarness();
    let used: unknown;
    const repo = h.repository;
    const original = repo.insertNotification.bind(repo);
    repo.insertNotification = async (r, t) => {
      used = t;
      return original(r, t);
    };
    const callerTx = { marker: 'caller' } as never;
    await h.service.notify(h.examInput([ALICE]), callerTx);
    expect(used).toBe(callerTx);
  });
});

describe('once-only keys (decision Q1)', () => {
  it('the same key never creates a second notification for the same account', async () => {
    const h = createNotificationHarness();
    const first = await h.service.notify(h.examInput([ALICE, BOB], 'evt-1'));
    const again = await h.service.notify(h.examInput([ALICE, BOB], 'evt-1'));
    expect(first.created).toEqual([ALICE, BOB]);
    expect(again.created).toEqual([]);
    expect(again.duplicates).toEqual([ALICE, BOB]);
    expect(h.repository.notifications.size).toBe(2);
  });

  it('is per recipient and per key', async () => {
    const h = createNotificationHarness();
    await h.service.notify(h.examInput([ALICE], 'evt-1'));
    const other = await h.service.notify(h.examInput([ALICE, BOB], 'evt-1'));
    expect(other.created).toEqual([BOB]);
    expect(other.duplicates).toEqual([ALICE]);
    const newKey = await h.service.notify(h.examInput([ALICE], 'evt-2'));
    expect(newKey.created).toEqual([ALICE]);
  });

  it('stores ONLY recipient, key and time, and writes the key before the notification', async () => {
    const h = createNotificationHarness();
    const order: string[] = [];
    const repo = h.repository;
    const insertKey = repo.insertDedupKey.bind(repo);
    const insertNotification = repo.insertNotification.bind(repo);
    repo.insertDedupKey = async (...a) => (order.push('key'), insertKey(...a));
    repo.insertNotification = async (...a) => (order.push('notification'), insertNotification(...a));
    await h.service.notify(h.examInput([ALICE], 'evt-1'));
    expect(order).toEqual(['key', 'notification']);
    expect([...h.repository.dedupKeys.entries()]).toEqual([[`${ALICE}\u0000evt-1`, h.clock.now()]]);
  });

  it('a deleted notification is NOT recreated when the same event or reminder is processed again', async () => {
    const h = createNotificationHarness();
    await h.service.notify(h.examInput([ALICE], 'reminder-1'));
    const id = mine(h, ALICE)[0]!.id;
    await h.service.deleteNotification(ALICE, id);
    expect(mine(h, ALICE)).toHaveLength(0);
    expect(h.repository.dedupKeys.size).toBe(1); // the key survived the hard delete

    const retry = await h.service.notify(h.examInput([ALICE], 'reminder-1'));
    expect(retry.created).toEqual([]);
    expect(mine(h, ALICE)).toHaveLength(0);

    await h.service.notify(h.examInput([ALICE], 'reminder-2'));
    await h.service.clearAll(ALICE);
    expect(h.repository.dedupKeys.size).toBe(2); // clear-all keeps the keys too
    expect((await h.service.notify(h.examInput([ALICE], 'reminder-2'))).created).toEqual([]);
  });
});

describe('account-level management (all devices see the same state)', () => {
  async function seed(h: ReturnType<typeof createNotificationHarness>, userId: string, count: number) {
    for (let i = 0; i < count; i += 1) {
      await h.service.notify(h.examInput([userId], `${userId}-${i}`));
      h.advance(1000);
    }
  }

  it('lists only the caller\'s notifications, newest first, with paging and the unread filter', async () => {
    const h = createNotificationHarness();
    await seed(h, ALICE, 5);
    await seed(h, BOB, 2);
    const page1 = await h.service.list(ALICE, listQuery({}, 'desc', { page: 1, pageSize: 2 }));
    expect(page1.total).toBe(5);
    expect(page1.totalPages).toBe(3);
    expect(page1.items).toHaveLength(2);
    expect(page1.items[0]!.createdAt.getTime()).toBeGreaterThan(page1.items[1]!.createdAt.getTime());
    const oldestFirst = await h.service.list(ALICE, listQuery({}, 'asc'));
    expect(oldestFirst.items[0]!.createdAt.getTime()).toBeLessThan(oldestFirst.items[4]!.createdAt.getTime());

    await h.service.markRead(ALICE, page1.items[0]!.id);
    expect((await h.service.list(ALICE, listQuery({ unread: true }))).total).toBe(4);
    expect((await h.service.list(BOB, listQuery())).total).toBe(2);
    expect(Object.keys(page1.items[0]!).sort()).toEqual(['body', 'createdAt', 'data', 'id', 'readAt', 'title', 'type']);
  });

  it('mark as read keeps the first read time; an unknown or foreign id changes nothing', async () => {
    const h = createNotificationHarness();
    await seed(h, ALICE, 1);
    await seed(h, BOB, 1);
    const aliceId = mine(h, ALICE)[0]!.id;
    const bobId = mine(h, BOB)[0]!.id;

    await h.service.markRead(ALICE, aliceId);
    const firstRead = mine(h, ALICE)[0]!.readAt;
    expect(firstRead).not.toBeNull();
    h.advance(60_000);
    await h.service.markRead(ALICE, aliceId);
    expect(mine(h, ALICE)[0]!.readAt).toEqual(firstRead);

    await h.service.markRead(ALICE, bobId); // Alice cannot mark Bob's notification
    expect(mine(h, BOB)[0]!.readAt).toBeNull();
    await expect(h.service.markRead(ALICE, 'does-not-exist')).resolves.toBeUndefined();
    expect(await h.service.unreadCount(ALICE)).toBe(0);
    expect(await h.service.unreadCount(BOB)).toBe(1);
  });

  it('mark all as read affects only the caller\'s account and keeps earlier read times', async () => {
    const h = createNotificationHarness();
    await seed(h, ALICE, 3);
    await seed(h, BOB, 2);
    const first = mine(h, ALICE).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0]!;
    await h.service.markRead(ALICE, first.id);
    const readAt = mine(h, ALICE).find((n) => n.id === first.id)!.readAt;
    h.advance(60_000);
    await h.service.markAllRead(ALICE);
    expect(await h.service.unreadCount(ALICE)).toBe(0);
    expect(mine(h, ALICE).find((n) => n.id === first.id)!.readAt).toEqual(readAt);
    expect(await h.service.unreadCount(BOB)).toBe(2);
  });

  it('delete is a HARD delete of one of the caller\'s notifications only; repeating it or using a foreign id changes nothing', async () => {
    const h = createNotificationHarness();
    await seed(h, ALICE, 2);
    await seed(h, BOB, 1);
    const [a1, a2] = mine(h, ALICE);
    const bobId = mine(h, BOB)[0]!.id;

    await h.service.deleteNotification(ALICE, a1!.id);
    expect(h.repository.notifications.has(a1!.id)).toBe(false); // the record is gone (no deleted_at, no archive)
    expect(h.repository.notifications.has(a2!.id)).toBe(true);
    await expect(h.service.deleteNotification(ALICE, a1!.id)).resolves.toBeUndefined();
    await h.service.deleteNotification(ALICE, bobId); // not Alice's
    expect(h.repository.notifications.has(bobId)).toBe(true);
    expect(Object.keys(mine(h, ALICE)[0]!)).not.toContain('deletedAt');
  });

  it('clear all permanently deletes every notification of the account and nobody else\'s', async () => {
    const h = createNotificationHarness();
    await seed(h, ALICE, 3);
    await seed(h, BOB, 2);
    await h.service.clearAll(ALICE);
    expect(mine(h, ALICE)).toHaveLength(0);
    expect(mine(h, BOB)).toHaveLength(2);
    await expect(h.service.clearAll(ALICE)).resolves.toBeUndefined();
  });

  it('the state is shared by every device of the account (it is per account, never per session)', async () => {
    const h = createNotificationHarness();
    await seed(h, ALICE, 2);
    // "Device A" and "device B" are just two requests of the same account.
    const id = (await h.service.list(ALICE, listQuery())).items[0]!.id;
    await h.service.markRead(ALICE, id); // done on device A
    expect((await h.service.list(ALICE, listQuery({ unread: true }))).total).toBe(1); // seen by device B
    await h.service.deleteNotification(ALICE, id); // deleted on device B
    expect((await h.service.list(ALICE, listQuery())).total).toBe(1); // gone on device A too
  });
});

describe('push deliveries are queued per subscription of the account', () => {
  it('queues one delivery per subscription of every recipient account, and none for other accounts', async () => {
    const h = createNotificationHarness();
    await h.subscribe(ALICE, 'session-a1', 'a-phone');
    await h.subscribe(ALICE, 'session-a2', 'a-laptop');
    await h.subscribe(BOB, 'session-b1', 'b-phone');
    await h.service.notify(h.examInput([ALICE]));
    expect(h.repository.deliveries.size).toBe(2);
    expect([...h.repository.deliveries.values()].every((d) => d.recipientUserId === ALICE)).toBe(true);
    expect(new Set([...h.repository.deliveries.values()].map((d) => d.notificationId)).size).toBe(1);
  });

  it('queues nothing when Web Push is not configured, but still creates the notification', async () => {
    const h = createNotificationHarness({ pushEnabled: false });
    await h.repository.upsertSubscription({ id: 's1', userId: ALICE, sessionId: 'x', endpoint: h.endpoint('x'), p256dh: 'p'.repeat(20), auth: 'a'.repeat(20), createdAt: h.clock.now() }, h.tx);
    await h.service.notify(h.examInput([ALICE]));
    expect(h.repository.notifications.size).toBe(1);
    expect(h.repository.deliveries.size).toBe(0);
  });

  it('hard-deleting a notification also removes its queued deliveries', async () => {
    const h = createNotificationHarness();
    await h.subscribe(ALICE, 's1', 'a-phone');
    await h.service.notify(h.examInput([ALICE]));
    await h.service.deleteNotification(ALICE, mine(h, ALICE)[0]!.id);
    expect(h.repository.deliveries.size).toBe(0);
  });
});

describe('errors are internal or localized', () => {
  it('AppError is used for user-facing errors only', async () => {
    const h = createNotificationHarness({ pushEnabled: false });
    const e = await rejection(h.push.subscribe(ALICE, 's', { endpoint: h.endpoint('x'), p256dh: 'p'.repeat(20), auth: 'a'.repeat(20) }));
    expect(e).toBeInstanceOf(AppError);
    expect((e as AppError).code).toBe('PUSH_NOT_CONFIGURED');
    expect(EXAM_TEMPLATE.key).toBe('test.exam-result');
  });
});
