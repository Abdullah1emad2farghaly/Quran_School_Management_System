import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { REPORTS, createReportsApi } from '../../helpers/reports-api-harness';
import { ApiConformance } from '../support/conformance';

describe('Module 38 endpoints conform to their OpenAPI documentation (real responses, real authorization and scope)', () => {
  let api: ApiConformance;
  beforeAll(async () => {
    api = await ApiConformance.create();
  });

  it('payment report: JSON, CSV and Excel, with their error responses', async () => {
    const { app, t, login, firstLoginAndChange } = await createReportsApi();
    const schoolA = await t.newSchool('مدرسة النور');
    const schoolB = await t.newSchool('مدرسة الهدى');
    const managerA = await t.newSchoolManager(schoolA.id);
    const managerB = await t.newSchoolManager(schoolB.id);
    const students = [await t.newStudent(schoolA.id, managerA.id), await t.newStudent(schoolA.id, managerA.id)];
    await t.newStudent(schoolB.id, managerB.id);
    t.setNow('2026-10-10T09:00:00Z');
    await t.subscriptions.createMonthlySubscriptions(schoolA.id, managerA.id);
    const sub = async (i: number, month: string) => (await t.subscriptionRepo.findByStudentMonth(students[i]!.id, month))!.snapshot.id;
    await t.payments.recordPayment(await sub(0, '2026-10'), managerA.id);
    await t.subscriptions.waiveSubscription(await sub(1, '2026-10'), managerA.id);
    t.setNow('2026-11-10T09:00:00Z');
    await t.subscriptions.createMonthlySubscriptions(schoolA.id, managerA.id);
    const collector = await t.newCollector(schoolA.id, managerA.id);
    const authA = await login(managerA);
    const authB = await login(managerB);
    const { blocked, auth: authC } = await firstLoginAndChange(collector);
    const authOrg = await login(t.orgAdmin);
    const foreignOrg = await t.otherOrg();
    const foreignSchool = await t.newSchool('مدرسة أجنبية', foreignOrg.id);

    // ---- JSON: the numbers are exactly what the owning modules hold
    const all = api.conforms(await request(app).get(`${REPORTS}/payment?period=ACROSS_TIME`).set(authA));
    expect(all.status).toBe(200);
    expect(all.body.data.rows).toEqual([
      { schoolId: schoolA.id, schoolName: 'مدرسة النور', month: '2026-10', paid: 1, unpaid: 0, waived: 1, subscriptions: 2, paymentsRecorded: 1, paymentsReversed: 0 },
      { schoolId: schoolA.id, schoolName: 'مدرسة النور', month: '2026-11', paid: 0, unpaid: 2, waived: 0, subscriptions: 2, paymentsRecorded: 0, paymentsReversed: 0 },
    ]);
    expect(all.body.data.totals).toEqual({ paid: 1, unpaid: 2, waived: 1, subscriptions: 4, paymentsRecorded: 1, paymentsReversed: 0 });
    expect(all.body.data.period).toEqual({ kind: 'ACROSS_TIME', startDate: null, endDate: null });
    const thisMonth = api.conforms(await request(app).get(`${REPORTS}/payment?period=THIS_MONTH&schoolId=${schoolA.id}`).set(authA));
    expect(thisMonth.body.data.rows.map((r: { month: string }) => r.month)).toEqual(['2026-11']);
    const lastMonth = api.conforms(await request(app).get(`${REPORTS}/payment?period=LAST_MONTH`).set(authA));
    expect(lastMonth.body.data.rows.map((r: { month: string }) => r.month)).toEqual(['2026-10']);
    const custom = api.conforms(await request(app).get(`${REPORTS}/payment?period=CUSTOM&startDate=2026-10-01&endDate=2026-10-31`).set(authA));
    expect(custom.body.data.rows.map((r: { month: string }) => r.month)).toEqual(['2026-10']);
    // the Collector of the school reports on that school; School Manager B sees nothing of school A (no rows, never a 200 with A's data)
    expect(api.conforms(await request(app).get(`${REPORTS}/payment?period=ACROSS_TIME`).set(authC)).body.data.totals.subscriptions).toBe(4);
    expect(api.conforms(await request(app).get(`${REPORTS}/payment?period=ACROSS_TIME`).set(authB)).body.data.rows).toEqual([]);

    // a Collector who has not yet made the mandatory password change gets no report
    const refused = api.conforms(blocked);
    expect(refused.status).toBe(403);
    expect(refused.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');

    // the Organization Manager reports on every school of their organization (also narrowed to one) and on nothing of another organization
    expect(api.conforms(await request(app).get(`${REPORTS}/payment?period=ACROSS_TIME`).set(authOrg)).body.data.totals.subscriptions).toBe(4);
    expect(api.conforms(await request(app).get(`${REPORTS}/payment?period=ACROSS_TIME&schoolId=${schoolB.id}`).set(authOrg)).body.data.rows).toEqual([]);
    const foreign = api.conforms(await request(app).get(`${REPORTS}/payment?period=ACROSS_TIME&schoolId=${foreignSchool.id}`).set(authOrg));
    expect(foreign.status).toBe(403);
    expect(foreign.body.error.code).toBe('REPORT_SCOPE_FORBIDDEN');

    // ---- JSON: errors
    api.conforms(await request(app).get(`${REPORTS}/payment`).set(authA)); // 400 period missing
    api.conforms(await request(app).get(`${REPORTS}/payment?period=FOREVER`).set(authA)); // 400 INVALID_REPORT_PERIOD
    api.conforms(await request(app).get(`${REPORTS}/payment?period=CUSTOM`).set(authA)); // 400 dates required
    api.conforms(await request(app).get(`${REPORTS}/payment?period=THIS_MONTH&startDate=2026-10-01`).set(authA)); // 400 dates not allowed
    api.conforms(await request(app).get(`${REPORTS}/payment?period=CUSTOM&startDate=2026-10-31&endDate=2026-10-01`).set(authA)); // 400 start after end
    api.conforms(await request(app).get(`${REPORTS}/payment?period=ACROSS_TIME&schoolId=not-a-uuid`).set(authA)); // 400
    const outside = api.conforms(await request(app).get(`${REPORTS}/payment?period=ACROSS_TIME&schoolId=${schoolA.id}`).set(authB));
    expect(outside.status).toBe(403);
    expect(outside.body.error.code).toBe('REPORT_SCOPE_FORBIDDEN');
    api.conforms(await request(app).get(`${REPORTS}/payment?period=ACROSS_TIME&schoolId=${schoolB.id}`).set(authC)); // 403 the Collector is not linked to school B
    api.conforms(await request(app).get(`${REPORTS}/payment?period=ACROSS_TIME`)); // 401

    // ---- CSV
    const csv = api.conforms(await request(app).get(`${REPORTS}/payment/csv?period=ACROSS_TIME`).set(authA));
    expect(csv.status).toBe(200);
    expect(csv.headers['content-disposition']).toContain('payment-report-across-time.csv');
    expect(csv.text).toContain('مدرسة النور');
    api.conforms(await request(app).get(`${REPORTS}/payment/csv?period=ACROSS_TIME&schoolId=${schoolA.id}`).set(authB)); // 403
    api.conforms(await request(app).get(`${REPORTS}/payment/csv`).set(authA)); // 400
    api.conforms(await request(app).get(`${REPORTS}/payment/csv?period=ACROSS_TIME`)); // 401

    // ---- Excel
    const xlsx = api.conforms(await request(app).get(`${REPORTS}/payment/xlsx?period=THIS_MONTH`).set(authC));
    expect(xlsx.status).toBe(200);
    expect(xlsx.headers['content-type']).toContain('spreadsheetml');
    api.conforms(await request(app).get(`${REPORTS}/payment/xlsx?period=ACROSS_TIME&schoolId=${schoolA.id}`).set(authB)); // 403
    api.conforms(await request(app).get(`${REPORTS}/payment/xlsx?period=FOREVER`).set(authA)); // 400
    api.conforms(await request(app).get(`${REPORTS}/payment/xlsx?period=ACROSS_TIME`)); // 401

    api.assertAllExercised('38');
  });
});