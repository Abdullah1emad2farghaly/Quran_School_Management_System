import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { NOTIFICATIONS_BASE as base, buildNotificationApp } from '../../helpers/notification-http';
import { AUTH, P256DH } from '../../helpers/notification-harness';
import { ApiConformance } from '../support/conformance';

describe('Module 31 endpoints conform to their OpenAPI documentation (real responses)', () => {
  let api: ApiConformance;
  beforeAll(async () => {
    api = await ApiConformance.create();
  });

  it('notifications and Web Push: success and error responses', async () => {
    const { app, notifications, userWithDevices } = buildNotificationApp();
    const me = await userWithDevices();
    const bearer = me.bearer();
    for (let i = 0; i < 3; i += 1) await notifications.service.notify(notifications.examInput([me.user.id]));

    const list = api.conforms(await request(app).get(base).set(bearer));
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(3);
    api.conforms(await request(app).get(base)); // 401
    api.conforms(await request(app).get(base).query({ bogus: '1' }).set(bearer)); // 400
    api.conforms(await request(app).get(base).query({ 'filter[unread]': 'true', sort: '-createdAt' }).set(bearer));
    expect(api.conforms(await request(app).get(`${base}/unread-count`).set(bearer)).body.data.unreadCount).toBe(3);

    const id = list.body.data[0].id as string;
    expect(api.conforms(await request(app).post(`${base}/${id}/read`).set(bearer)).status).toBe(204);
    api.conforms(await request(app).post(`${base}/not-a-uuid/read`).set(bearer)); // 400
    api.conforms(await request(app).post(`${base}/${id}/read`)); // 401
    expect(api.conforms(await request(app).post(`${base}/read-all`).set(bearer)).status).toBe(204);

    expect(api.conforms(await request(app).get(`${base}/push/public-key`).set(bearer)).status).toBe(200);
    const sub = { endpoint: 'https://push.example.com/send/phone', keys: { p256dh: P256DH, auth: AUTH } };
    expect(api.conforms(await request(app).post(`${base}/push-subscriptions`).set(bearer).send(sub)).status).toBe(200);
    api.conforms(await request(app).post(`${base}/push-subscriptions`).set(bearer).send({ ...sub, endpoint: 'http://push.example.com/x' })); // 400 INVALID_PUSH_SUBSCRIPTION
    api.conforms(await request(app).post(`${base}/push-subscriptions`).set(bearer).send({})); // 400 validation
    expect(api.conforms(await request(app).get(`${base}/push-subscriptions`).set(bearer)).body.data.items).toHaveLength(1);
    expect(api.conforms(await request(app).post(`${base}/push-subscriptions/unsubscribe`).set(bearer).send({ endpoint: sub.endpoint })).status).toBe(204);

    expect(api.conforms(await request(app).delete(`${base}/${id}`).set(bearer)).status).toBe(204);
    api.conforms(await request(app).delete(`${base}/not-a-uuid`).set(bearer)); // 400
    expect(api.conforms(await request(app).delete(base).set(bearer)).status).toBe(204);
  });

  it('answers the documented 422 when Web Push is not configured', async () => {
    const { app, userWithDevices } = buildNotificationApp({ pushEnabled: false });
    const me = await userWithDevices();
    const res = api.conforms(await request(app).get(`${base}/push/public-key`).set(me.bearer()));
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('PUSH_NOT_CONFIGURED');
  });

  it('exercised every documented operation of Module 31', () => {
    expect(api.operationCount('31')).toBe(10);
    api.assertAllExercised('31');
  });
});
