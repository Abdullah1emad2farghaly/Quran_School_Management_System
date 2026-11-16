import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { NOTIFICATIONS_BASE as base, buildNotificationApp } from '../helpers/notification-http';
import { AUTH, P256DH } from '../helpers/notification-harness';

const subscription = (name: string) => ({ endpoint: `https://push.example.com/send/${name}`, keys: { p256dh: P256DH, auth: AUTH } });

describe('authentication', () => {
  it('every operation requires a valid access token', async () => {
    const { app } = buildNotificationApp();
    const id = '3d2f8b4a-6c1e-4f7a-9b50-2a8d4c6e1f93';
    const calls = [
      request(app).get(base),
      request(app).get(`${base}/unread-count`),
      request(app).post(`${base}/read-all`),
      request(app).delete(base),
      request(app).post(`${base}/${id}/read`),
      request(app).delete(`${base}/${id}`),
      request(app).get(`${base}/push/public-key`),
      request(app).get(`${base}/push-subscriptions`),
      request(app).post(`${base}/push-subscriptions`).send(subscription('x')),
      request(app).post(`${base}/push-subscriptions/unsubscribe`).send({ endpoint: subscription('x').endpoint }),
    ];
    for (const res of await Promise.all(calls)) expect(res.status).toBe(401);
  });
});

describe('account-level notifications', () => {
  it('lists the caller\'s notifications, newest first, without caching, with paging and the unread filter', async () => {
    const { app, notifications, userWithDevices } = buildNotificationApp();
    const me = await userWithDevices();
    for (let i = 0; i < 3; i += 1) {
      await notifications.service.notify(notifications.examInput([me.user.id]));
      notifications.advance(1000);
    }
    const res = await request(app).get(base).query({ pageSize: 2 }).set(me.bearer());
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.data).toHaveLength(2);
    expect(res.body.meta.total).toBe(3);
    expect(Object.keys(res.body.data[0]).sort()).toEqual(['body', 'createdAt', 'data', 'id', 'readAt', 'title', 'type']);
    expect(new Date(res.body.data[0].createdAt).getTime()).toBeGreaterThan(new Date(res.body.data[1].createdAt).getTime());
    expect(res.body.data[0].title).toBe('نتيجة اختبار Ali');

    await request(app).post(`${base}/${res.body.data[0].id}/read`).set(me.bearer());
    const unread = await request(app).get(base).query({ 'filter[unread]': 'true' }).set(me.bearer());
    expect(unread.body.meta.total).toBe(2);
    expect((await request(app).get(`${base}/unread-count`).set(me.bearer())).body.data).toEqual({ unreadCount: 2 });
    expect((await request(app).get(base).query({ bogus: '1' }).set(me.bearer())).status).toBe(400);
  });

  it('every device of the account sees the same state: read, mark-all, delete and clear-all act on the whole account', async () => {
    const { app, notifications, userWithDevices } = buildNotificationApp();
    const me = await userWithDevices(3);
    for (let i = 0; i < 4; i += 1) await notifications.service.notify(notifications.examInput([me.user.id]));
    const listOn = async (device: number) => (await request(app).get(base).set(me.bearer(device))).body;

    const first = (await listOn(0)).data[0].id as string;
    expect((await request(app).post(`${base}/${first}/read`).set(me.bearer(0))).status).toBe(204);
    expect((await request(app).get(`${base}/unread-count`).set(me.bearer(1))).body.data.unreadCount).toBe(3);

    expect((await request(app).delete(`${base}/${first}`).set(me.bearer(2))).status).toBe(204);
    expect((await listOn(0)).meta.total).toBe(3);
    expect((await request(app).delete(`${base}/${first}`).set(me.bearer(1))).status).toBe(204); // repeating changes nothing

    expect((await request(app).post(`${base}/read-all`).set(me.bearer(1))).status).toBe(204);
    expect((await request(app).get(`${base}/unread-count`).set(me.bearer(2))).body.data.unreadCount).toBe(0);

    expect((await request(app).delete(base).set(me.bearer(2))).status).toBe(204);
    for (const device of [0, 1, 2]) expect((await listOn(device)).meta.total).toBe(0);
  });

  it('one account can never read, mark or delete another account\'s notifications', async () => {
    const { app, notifications, userWithDevices } = buildNotificationApp();
    const alice = await userWithDevices();
    const bob = await userWithDevices();
    await notifications.service.notify(notifications.examInput([alice.user.id]));
    await notifications.service.notify(notifications.examInput([bob.user.id]));
    const aliceId = (await request(app).get(base).set(alice.bearer())).body.data[0].id as string;

    expect((await request(app).get(base).set(bob.bearer())).body.data.map((n: { id: string }) => n.id)).not.toContain(aliceId);
    expect((await request(app).post(`${base}/${aliceId}/read`).set(bob.bearer())).status).toBe(204); // same answer as for an unknown id
    expect((await request(app).delete(`${base}/${aliceId}`).set(bob.bearer())).status).toBe(204);
    expect((await request(app).get(`${base}/unread-count`).set(alice.bearer())).body.data.unreadCount).toBe(1);
    expect((await request(app).get(base).set(alice.bearer())).body.meta.total).toBe(1);

    await request(app).delete(base).set(bob.bearer());
    expect((await request(app).get(base).set(alice.bearer())).body.meta.total).toBe(1);
    expect((await request(app).post(`${base}/not-a-uuid/read`).set(alice.bearer())).status).toBe(400);
    expect((await request(app).delete(`${base}/not-a-uuid`).set(alice.bearer())).status).toBe(400);
  });

  it('a deleted notification is gone for good and is not recreated by the same event', async () => {
    const { app, notifications, userWithDevices } = buildNotificationApp();
    const me = await userWithDevices();
    await notifications.service.notify(notifications.examInput([me.user.id], 'evt-1'));
    const id = (await request(app).get(base).set(me.bearer())).body.data[0].id as string;
    await request(app).delete(`${base}/${id}`).set(me.bearer());
    await notifications.service.notify(notifications.examInput([me.user.id], 'evt-1'));
    expect((await request(app).get(base).set(me.bearer())).body.meta.total).toBe(0);
  });
});

describe('Web Push subscriptions', () => {
  it('gives the VAPID public key (never the private key)', async () => {
    const { app, userWithDevices } = buildNotificationApp();
    const me = await userWithDevices();
    const res = await request(app).get(`${base}/push/public-key`).set(me.bearer());
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ publicKey: expect.any(String) });
    expect(Object.keys(res.body.data)).toEqual(['publicKey']);
  });

  it('answers a localized 422 PUSH_NOT_CONFIGURED when push is disabled, while notifications keep working', async () => {
    const { app, notifications, userWithDevices } = buildNotificationApp({ pushEnabled: false });
    const me = await userWithDevices();
    const res = await request(app).get(`${base}/push/public-key`).set(me.bearer()).set('Accept-Language', 'ar');
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('PUSH_NOT_CONFIGURED');
    expect(res.body.error.message).toMatch(/غير مفعّلة/);
    expect((await request(app).post(`${base}/push-subscriptions`).set(me.bearer()).send(subscription('x'))).status).toBe(422);
    await notifications.service.notify(notifications.examInput([me.user.id]));
    expect((await request(app).get(base).set(me.bearer())).body.meta.total).toBe(1);
  });

  it('subscribes for the calling session, lists safe fields only, and unsubscribes without touching notifications', async () => {
    const { app, notifications, userWithDevices } = buildNotificationApp();
    const me = await userWithDevices(2);
    await notifications.service.notify(notifications.examInput([me.user.id]));

    const created = await request(app).post(`${base}/push-subscriptions`).set(me.bearer(0)).send(subscription('phone'));
    expect(created.status).toBe(200);
    expect(created.body.data.isCurrentSession).toBe(true);
    await request(app).post(`${base}/push-subscriptions`).set(me.bearer(1)).send(subscription('laptop'));
    const sessionIds = [...notifications.repository.subscriptions.values()].map((s) => s.sessionId);
    expect(new Set(sessionIds).size).toBe(2); // each subscription is linked to the session that created it

    const list = await request(app).get(`${base}/push-subscriptions`).set(me.bearer(0));
    expect(list.body.data.items).toHaveLength(2);
    expect(list.body.data.items.filter((s: { isCurrentSession: boolean }) => s.isCurrentSession)).toHaveLength(1);
    expect(JSON.stringify(list.body)).not.toContain('push.example.com');
    expect(JSON.stringify(list.body)).not.toContain(P256DH);

    expect((await request(app).post(`${base}/push-subscriptions/unsubscribe`).set(me.bearer(0)).send({ endpoint: subscription('phone').endpoint })).status).toBe(204);
    expect((await request(app).get(`${base}/push-subscriptions`).set(me.bearer(0))).body.data.items).toHaveLength(1);
    expect((await request(app).get(base).set(me.bearer(0))).body.meta.total).toBe(1);
  });

  it('rejects an invalid subscription: 400 for a malformed body, 400 INVALID_PUSH_SUBSCRIPTION for an unsafe endpoint', async () => {
    const { app, userWithDevices } = buildNotificationApp();
    const me = await userWithDevices();
    expect((await request(app).post(`${base}/push-subscriptions`).set(me.bearer()).send({})).status).toBe(400);
    expect((await request(app).post(`${base}/push-subscriptions`).set(me.bearer()).send({ endpoint: 'https://push.example.com/x' })).status).toBe(400);
    const unsafe = await request(app).post(`${base}/push-subscriptions`).set(me.bearer()).send({ ...subscription('x'), endpoint: 'https://127.0.0.1/x' });
    expect(unsafe.status).toBe(400);
    expect(unsafe.body.error.code).toBe('INVALID_PUSH_SUBSCRIPTION');
    expect((await request(app).post(`${base}/push-subscriptions/unsubscribe`).set(me.bearer()).send({})).status).toBe(400);
  });
});
