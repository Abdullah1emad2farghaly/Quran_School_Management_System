import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { AUDIT_LOGS, createAuditApi } from '../../helpers/audit-api-harness';
import { ApiConformance } from '../support/conformance';

const UNKNOWN = '00000000-0000-4000-8000-000000000000';

describe('Module 35 endpoints conform to their OpenAPI documentation (real responses, real authorization)', () => {
  let api: ApiConformance;
  beforeAll(async () => {
    api = await ApiConformance.create();
  });

  it('audit logs: list and read for each role that may, and every documented error response', async () => {
    const { app, t, login, recorder, organizations, schools } = await createAuditApi();
    const schoolA = await t.newSchool('مدرسة أ');
    const schoolB = await t.newSchool('مدرسة ب');
    const managerA = await t.newSchoolManager(schoolA.id);
    const managerB = await t.newSchoolManager(schoolB.id);
    schools.set(managerA.id, [schoolA.id]);
    schools.set(managerB.id, [schoolB.id]);
    organizations.set(t.orgAdmin.id, [t.org.id]);
    const event = (n: number, schoolId: string, type = 'SubscriptionPaid') => ({
      eventId: `5f1d8a40-0000-4000-8000-00000000000${n}`,
      eventType: type,
      occurredAt: new Date(`2026-11-16T09:3${n}:00Z`),
      aggregateType: 'Subscription',
      aggregateId: `sub-${n}`,
      payload: { schoolId, organizationId: t.org.id, status: 'PAID' },
      metadata: { requestId: `r-${n}`, actorUserId: managerA.id, ipAddress: '203.0.113.7', userAgent: 'UA/1' },
    });
    await recorder.record(event(1, schoolA.id));
    await recorder.record(event(2, schoolB.id));
    await recorder.record(event(3, schoolA.id, 'SubscriptionMarkedUnpaid'));
    const mainAdmin = await login(await t.h.createUser({ role: 'MAIN_ADMIN' }));
    const orgAdmin = await login(t.orgAdmin);
    const authA = await login(managerA);

    // ---- list: each role sees only what its scope allows
    const all = api.conforms(await request(app).get(AUDIT_LOGS).set(mainAdmin));
    expect(all.status).toBe(200);
    expect(all.body.data).toHaveLength(3);
    expect(api.conforms(await request(app).get(AUDIT_LOGS).set(orgAdmin)).body.data).toHaveLength(3);
    const own = api.conforms(await request(app).get(`${AUDIT_LOGS}?sort=timestamp&filter[action]=PAYMENT&filter[module]=subscriptions&filter[from]=2026-11-16&filter[to]=2026-11-16`).set(authA));
    expect(own.status).toBe(200);
    expect(own.body.data.every((r: { schoolId: string }) => r.schoolId === schoolA.id)).toBe(true);
    api.conforms(await request(app).get(`${AUDIT_LOGS}?filter[action]=NOT_AN_ACTION`).set(authA)); // 400
    api.conforms(await request(app).get(`${AUDIT_LOGS}?filter[actorUserId]=not-a-uuid`).set(authA)); // 400
    api.conforms(await request(app).get(AUDIT_LOGS)); // 401
    const collector = await t.newCollector(schoolA.id, managerA.id);
    await t.h.identity.changePassword?.(collector.collector.userId, 'New-pass-123');
    api.conforms(await request(app).get(AUDIT_LOGS).set(await login({ phone: collector.phone, password: 'New-pass-123' }))); // 403

    // ---- read
    const mine = own.body.data[0].id as string;
    const read = api.conforms(await request(app).get(`${AUDIT_LOGS}/${mine}`).set(authA));
    expect(read.status).toBe(200);
    expect(read.headers['cache-control']).toBe('no-store');
    const other = (all.body.data as Array<{ id: string; schoolId: string }>).find((r) => r.schoolId === schoolB.id)!.id;
    expect(api.conforms(await request(app).get(`${AUDIT_LOGS}/${other}`).set(authA)).status).toBe(404); // outside the caller's scope: existence not revealed
    expect(api.conforms(await request(app).get(`${AUDIT_LOGS}/${other}`).set(mainAdmin)).status).toBe(200);
    api.conforms(await request(app).get(`${AUDIT_LOGS}/${UNKNOWN}`).set(authA)); // 404
    api.conforms(await request(app).get(`${AUDIT_LOGS}/not-a-uuid`).set(authA)); // 400
    api.conforms(await request(app).get(`${AUDIT_LOGS}/${mine}`)); // 401
    api.conforms(await request(app).get(`${AUDIT_LOGS}/${mine}`).set(await login({ phone: collector.phone, password: 'New-pass-123' }))); // 403

    expect(api.operationCount('35')).toBe(2);
    api.assertAllExercised('35');
  });
});
