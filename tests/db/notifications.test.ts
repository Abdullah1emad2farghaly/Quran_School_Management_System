/**
 * Real-database checks for Module 31 (Notifications Core), MariaDB via XAMPP. NOT part of `npm test`.
 * Prerequisite: `npm run db:migrate` (creates notifications, notification_dedup_keys, push_subscriptions, push_deliveries).
 * Run: npm run test:db. Notifications reference accounts by plain id (no foreign key to users), so the tests use random ids and delete everything they created afterwards.
 */
import { randomUUID } from 'node:crypto';
import { QueryTypes } from 'sequelize';
import { afterAll, describe, expect, it } from 'vitest';
import { env } from '../../src/config/env';
import { SystemClock } from '../../src/modules/00-shared-kernel/public';
import { SequelizeUnitOfWork, createSequelize } from '../../src/modules/02-database/public';
import {
  NotificationService,
  NotificationTemplateRegistry,
  PushDeliveryProcessor,
  PushSubscriptionService,
  SequelizeNotificationRepository,
  noAccountLanguage,
} from '../../src/modules/31-notifications-core/public';
import { AUTH, FakePushSender, P256DH } from '../helpers/notification-harness';

const sequelize = createSequelize(env.database);
const uow = new SequelizeUnitOfWork(sequelize);
const repository = new SequelizeNotificationRepository(sequelize);
const clock = new SystemClock();
const templates = new NotificationTemplateRegistry();
templates.register({ key: 'db.test', type: 'DB_TEST', title: { ar: 'عنوان {n}', en: 'Title {n}' }, body: { ar: 'نص {n}', en: 'Body {n}' } });
const service = new NotificationService({ repository, unitOfWork: uow, clock, templates, language: noAccountLanguage, pushEnabled: true });
const push = new PushSubscriptionService({ repository, unitOfWork: uow, clock, pushEnabled: true, vapidPublicKey: 'public' });
const sender = new FakePushSender();
const processor = new PushDeliveryProcessor({ repository, sender, unitOfWork: uow, clock });

const users: string[] = [];
const sessionIds: string[] = [];
const newUser = () => {
  const id = randomUUID();
  users.push(id);
  return id;
};
const newSession = () => {
  const id = randomUUID();
  sessionIds.push(id);
  return id;
};
const endpoint = () => `https://push.example.com/send/${randomUUID()}`;
const subscribe = (user: string, session: string, e = endpoint()) => push.subscribe(user, session, { endpoint: e, p256dh: P256DH, auth: AUTH });
const notify = (recipients: string[], key: string) => service.notify({ recipientUserIds: recipients, templateKey: 'db.test', params: { n: 1 }, data: { k: key }, dedupKey: key });
const count = async (sql: string, replacements: Record<string, unknown>) => Number((await sequelize.query<{ n: number | string }>(sql, { replacements, type: QueryTypes.SELECT }))[0]!.n);
const notificationsOf = (user: string) => count('SELECT COUNT(*) AS n FROM notifications WHERE recipient_user_id = :user', { user });
const keysOf = (user: string) => count('SELECT COUNT(*) AS n FROM notification_dedup_keys WHERE recipient_user_id = :user', { user });
const deliveriesOf = (user: string) => count('SELECT COUNT(*) AS n FROM push_deliveries WHERE recipient_user_id = :user', { user });

afterAll(async () => {
  if (users.length > 0) {
    await sequelize.query('DELETE FROM push_deliveries WHERE recipient_user_id IN (:users)', { replacements: { users } });
    await sequelize.query('DELETE FROM push_subscriptions WHERE user_id IN (:users)', { replacements: { users } });
    await sequelize.query('DELETE FROM notifications WHERE recipient_user_id IN (:users)', { replacements: { users } });
    await sequelize.query('DELETE FROM notification_dedup_keys WHERE recipient_user_id IN (:users)', { replacements: { users } });
  }
  await sequelize.close();
});

describe('schema', () => {
  it('the once-only ledger has exactly recipient_user_id, dedup_key and created_at, and a primary key over (recipient, key)', async () => {
    const columns = await sequelize.query<{ COLUMN_NAME: string }>(
      "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'notification_dedup_keys' ORDER BY ORDINAL_POSITION",
      { type: QueryTypes.SELECT },
    );
    expect(columns.map((c) => c.COLUMN_NAME)).toEqual(['recipient_user_id', 'dedup_key', 'created_at']);
    const pk = await sequelize.query<{ COLUMN_NAME: string }>(
      "SELECT COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'notification_dedup_keys' AND CONSTRAINT_NAME = 'PRIMARY' ORDER BY ORDINAL_POSITION",
      { type: QueryTypes.SELECT },
    );
    expect(pk.map((c) => c.COLUMN_NAME)).toEqual(['recipient_user_id', 'dedup_key']);
  });

  it('notifications have no soft-delete column and no foreign key to another module', async () => {
    const columns = await sequelize.query<{ COLUMN_NAME: string }>("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'notifications'", { type: QueryTypes.SELECT });
    expect(columns.map((c) => c.COLUMN_NAME).sort()).toEqual(['body', 'created_at', 'data', 'id', 'read_at', 'recipient_user_id', 'title', 'type']);
    const fks = await sequelize.query<{ REFERENCED_TABLE_NAME: string }>(
      "SELECT DISTINCT REFERENCED_TABLE_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('notifications','notification_dedup_keys','push_subscriptions','push_deliveries') AND REFERENCED_TABLE_NAME IS NOT NULL",
      { type: QueryTypes.SELECT },
    );
    expect(fks.map((f) => f.REFERENCED_TABLE_NAME).sort()).toEqual(['notifications', 'push_subscriptions']);
  });

  it('rejects a bad delivery status and an empty title', async () => {
    const u = newUser();
    await expect(sequelize.query("INSERT INTO notifications (id, recipient_user_id, type, title, body, created_at) VALUES (UUID(), :u, 'T', '', 'b', NOW(3))", { replacements: { u } })).rejects.toThrow();
    const subs = await subscribe(u, newSession());
    const n = await notify([u], `k-${randomUUID()}`);
    expect(n.created).toEqual([u]);
    const [notification] = await sequelize.query<{ id: string }>('SELECT id FROM notifications WHERE recipient_user_id = :u', { replacements: { u }, type: QueryTypes.SELECT });
    await expect(
      sequelize.query("INSERT INTO push_deliveries (id, notification_id, subscription_id, recipient_user_id, status, attempts, next_attempt_at, created_at) VALUES (UUID(), :n, :s, :u, 'BOGUS', 0, NOW(3), NOW(3))", { replacements: { n: notification!.id, s: subs.id, u } }),
    ).rejects.toThrow();
  });
});

describe('creation, once-only keys and hard delete', () => {
  it('creates one notification per account, in Arabic by default, and a second call with the same key creates nothing', async () => {
    const [a, b] = [newUser(), newUser()];
    const key = `evt-${randomUUID()}`;
    expect((await notify([a, b], key)).created).toEqual([a, b]);
    expect((await notify([a, b], key)).duplicates).toEqual([a, b]);
    expect(await notificationsOf(a)).toBe(1);
    const [row] = await sequelize.query<{ title: string }>('SELECT title FROM notifications WHERE recipient_user_id = :a', { replacements: { a }, type: QueryTypes.SELECT });
    expect(row!.title).toBe('عنوان 1');
  });

  it('simultaneous creation with the same key still creates exactly one notification', async () => {
    const u = newUser();
    const key = `race-${randomUUID()}`;
    const results = await Promise.all(Array.from({ length: 6 }, () => notify([u], key).catch(() => ({ created: [], duplicates: [u] }))));
    expect(results.flatMap((r) => r.created)).toHaveLength(1);
    expect(await notificationsOf(u)).toBe(1);
    expect(await keysOf(u)).toBe(1);
  });

  it('hard delete removes the row and its deliveries, keeps the once-only key, and the same key cannot bring it back', async () => {
    const u = newUser();
    await subscribe(u, newSession());
    const key = `evt-${randomUUID()}`;
    await notify([u], key);
    expect(await deliveriesOf(u)).toBe(1);
    const [{ id }] = await sequelize.query<{ id: string }>('SELECT id FROM notifications WHERE recipient_user_id = :u', { replacements: { u }, type: QueryTypes.SELECT });

    await service.deleteNotification(u, id!);
    expect(await notificationsOf(u)).toBe(0);
    expect(await deliveriesOf(u)).toBe(0); // removed with it (ON DELETE CASCADE)
    expect(await keysOf(u)).toBe(1); // the key survives
    expect((await notify([u], key)).created).toEqual([]);
    expect(await notificationsOf(u)).toBe(0);

    await notify([u], `${key}-2`);
    await service.clearAll(u);
    expect(await notificationsOf(u)).toBe(0);
    expect(await keysOf(u)).toBe(2);
  });

  it('only the owner can mark or delete a notification, and mark-read keeps the first read time', async () => {
    const [a, b] = [newUser(), newUser()];
    await notify([a], `k-${randomUUID()}`);
    const [{ id }] = await sequelize.query<{ id: string }>('SELECT id FROM notifications WHERE recipient_user_id = :a', { replacements: { a }, type: QueryTypes.SELECT });
    await service.markRead(b, id!);
    await service.deleteNotification(b, id!);
    expect(await notificationsOf(a)).toBe(1);
    expect(await service.unreadCount(a)).toBe(1);

    await service.markRead(a, id!);
    const [{ read_at: first }] = await sequelize.query<{ read_at: Date }>('SELECT read_at FROM notifications WHERE id = :id', { replacements: { id }, type: QueryTypes.SELECT });
    await new Promise((r) => setTimeout(r, 20));
    await service.markRead(a, id!);
    const [{ read_at: second }] = await sequelize.query<{ read_at: Date }>('SELECT read_at FROM notifications WHERE id = :id', { replacements: { id }, type: QueryTypes.SELECT });
    expect(new Date(second).getTime()).toBe(new Date(first).getTime());
    expect(await service.unreadCount(a)).toBe(0);
  });

  it('lists newest first with paging and the unread filter', async () => {
    const u = newUser();
    for (let i = 0; i < 5; i += 1) {
      await notify([u], `p-${i}-${randomUUID()}`);
      await new Promise((r) => setTimeout(r, 5));
    }
    const page = await service.list(u, { page: { page: 1, pageSize: 2 }, sort: [{ key: 'createdAt', direction: 'desc' }], filters: {} } as never);
    expect(page.total).toBe(5);
    expect(page.items).toHaveLength(2);
    expect(page.items[0]!.createdAt.getTime()).toBeGreaterThanOrEqual(page.items[1]!.createdAt.getTime());
    await service.markAllRead(u);
    expect((await service.list(u, { page: { page: 1, pageSize: 20 }, sort: [], filters: { unread: true } } as never)).total).toBe(0);
  });
});

describe('push subscriptions and deliveries', () => {
  it('one endpoint belongs to one account: subscribing from another account moves it and drops what was queued for the first', async () => {
    const [a, b] = [newUser(), newUser()];
    const shared = endpoint();
    await subscribe(a, newSession(), shared);
    await notify([a], `k-${randomUUID()}`);
    expect(await deliveriesOf(a)).toBe(1);
    await subscribe(b, newSession(), shared);
    expect(await count('SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = :a', { a })).toBe(0);
    expect(await count('SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = :b', { b })).toBe(1);
    expect(await deliveriesOf(a)).toBe(0);
  });

  it('deleting the subscriptions of a session keeps the other sessions\' subscriptions and every notification', async () => {
    const u = newUser();
    const [s1, s2] = [newSession(), newSession()];
    await subscribe(u, s1);
    await subscribe(u, s2);
    await notify([u], `k-${randomUUID()}`);
    expect(await push.deleteForSession(s1)).toBe(1);
    expect(await count('SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = :u', { u })).toBe(1);
    expect(await notificationsOf(u)).toBe(1);
    expect(await push.deleteForSession(s1)).toBe(0);
  });

  it('sends queued pushes once, even when two passes run at the same time, and removes a gone subscription only', async () => {
    const u = newUser();
    const goneEndpoint = endpoint();
    const okEndpoint = endpoint();
    await subscribe(u, newSession(), goneEndpoint);
    await subscribe(u, newSession(), okEndpoint);
    await notify([u], `k-${randomUUID()}`);
    sender.sent.length = 0;
    sender.outcome = (t) => (t.endpoint === goneEndpoint ? { kind: 'gone' } : { kind: 'sent' });
    await Promise.all([processor.processDue(), processor.processDue()]); // the queue is shared with other rows, so only this user's endpoints are checked
    expect(sender.sent.filter((s) => s.target.endpoint === goneEndpoint)).toHaveLength(1); // each subscription was attempted exactly once
    expect(sender.sent.filter((s) => s.target.endpoint === okEndpoint)).toHaveLength(1);
    const remaining = await sequelize.query<{ endpoint: string }>('SELECT endpoint FROM push_subscriptions WHERE user_id = :u', { replacements: { u }, type: QueryTypes.SELECT });
    expect(remaining.map((r) => r.endpoint)).toEqual([okEndpoint]);
    expect(await deliveriesOf(u)).toBe(0);
    expect(await notificationsOf(u)).toBe(1);
  });

  it('retries a temporary failure later and marks it failed after the attempts are used up', async () => {
    const u = newUser();
    await subscribe(u, newSession());
    await notify([u], `k-${randomUUID()}`);
    sender.outcome = () => ({ kind: 'retry', error: 'HTTP 503' });
    expect((await processor.processDue()).retried).toBeGreaterThanOrEqual(1);
    const [d] = await sequelize.query<{ status: string; attempts: number; locked_until: Date | null }>('SELECT status, attempts, locked_until FROM push_deliveries WHERE recipient_user_id = :u', { replacements: { u }, type: QueryTypes.SELECT });
    expect(d).toMatchObject({ status: 'PENDING', attempts: 1, locked_until: null });
    await sequelize.query("UPDATE push_deliveries SET attempts = 4, next_attempt_at = NOW(3) - INTERVAL 1 SECOND WHERE recipient_user_id = :u", { replacements: { u } });
    await processor.processDue();
    const [failed] = await sequelize.query<{ status: string; attempts: number }>('SELECT status, attempts FROM push_deliveries WHERE recipient_user_id = :u', { replacements: { u }, type: QueryTypes.SELECT });
    expect(failed).toMatchObject({ status: 'FAILED', attempts: 5 });
    expect(await notificationsOf(u)).toBe(1);
    sender.outcome = () => ({ kind: 'sent' });
  });
});
