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

  });

  it('attendance report: JSON, CSV and Excel, with their error responses', async () => {
    const { app, t, login, firstLoginAndChange, recordAttendance } = await createReportsApi();
    const schoolA = await t.newSchool('مدرسة النور');
    const schoolB = await t.newSchool('مدرسة الهدى');
    const managerA = await t.newSchoolManager(schoolA.id);
    const managerB = await t.newSchoolManager(schoolB.id);
    const group = await t.newGroup(schoolA.id, managerA.id, 'حلقة الفجر');
    const parent = await t.newParent(schoolA.id, managerA.id);
    const student = await t.registerStudent(schoolA.id, parent.id, managerA.id, { joinDate: '2026-09-01' });
    await t.groups.assignStudent(group.id, student.id, managerA.id);
    const teacherId = '5b6c7d8e-9f0a-4b1c-8d2e-3f4a5b6c7d8e';
    const mark = (subjectType: 'STUDENT' | 'TEACHER', subjectId: string, status: 'PRESENT' | 'ABSENT', date: string) =>
      recordAttendance({ schoolId: schoolA.id, groupId: group.id, subjectType, subjectId, status, date });
    mark('STUDENT', student.id, 'ABSENT', '2026-08-20'); // before the join date: never reported
    mark('STUDENT', student.id, 'PRESENT', '2026-10-05');
    mark('STUDENT', student.id, 'ABSENT', '2026-10-12');
    mark('STUDENT', student.id, 'PRESENT', '2026-11-02');
    mark('TEACHER', teacherId, 'PRESENT', '2026-11-02');
    t.setNow('2026-11-10T09:00:00Z');
    const collector = await t.newCollector(schoolA.id, managerA.id);
    const authA = await login(managerA);
    const authB = await login(managerB);
    const authOrg = await login(t.orgAdmin);
    const { auth: authC } = await firstLoginAndChange(collector);

    // ---- JSON: the numbers follow the owning modules' data, and nothing before the join date
    const all = api.conforms(await request(app).get(`${REPORTS}/attendance?period=ACROSS_TIME`).set(authA));
    expect(all.status).toBe(200);
    expect(all.body.data.rows).toEqual([
      { subjectType: 'STUDENT', subjectId: student.id, subjectName: student.fullName, schoolId: schoolA.id, schoolName: 'مدرسة النور', groupId: group.id, groupName: 'حلقة الفجر', present: 2, absent: 1, total: 3 },
      { subjectType: 'TEACHER', subjectId: teacherId, subjectName: null, schoolId: schoolA.id, schoolName: 'مدرسة النور', groupId: group.id, groupName: 'حلقة الفجر', present: 1, absent: 0, total: 1 },
    ]);
    expect(all.body.data.totals).toEqual({ students: { present: 2, absent: 1, total: 3 }, teachers: { present: 1, absent: 0, total: 1 } });
    const thisMonth = api.conforms(await request(app).get(`${REPORTS}/attendance?period=THIS_MONTH&groupId=${group.id}`).set(authA));
    expect(thisMonth.body.data.totals.students).toEqual({ present: 1, absent: 0, total: 1 });
    const custom = api.conforms(await request(app).get(`${REPORTS}/attendance?period=CUSTOM&startDate=2026-10-01&endDate=2026-10-31&studentId=${student.id}`).set(authA));
    expect(custom.body.data.rows.map((r: { subjectType: string }) => r.subjectType)).toEqual(['STUDENT']); // a student filter has no teacher rows
    expect(custom.body.data.totals.students).toEqual({ present: 1, absent: 1, total: 2 });
    // the Organization Manager reports on every school of their organization; School Manager B sees nothing of school A
    expect(api.conforms(await request(app).get(`${REPORTS}/attendance?period=ACROSS_TIME`).set(authOrg)).body.data.rows).toHaveLength(2);
    expect(api.conforms(await request(app).get(`${REPORTS}/attendance?period=ACROSS_TIME`).set(authB)).body.data.rows).toEqual([]);

    // ---- JSON: errors
    api.conforms(await request(app).get(`${REPORTS}/attendance`).set(authA)); // 400 period missing
    api.conforms(await request(app).get(`${REPORTS}/attendance?period=FOREVER`).set(authA)); // 400 INVALID_REPORT_PERIOD
    api.conforms(await request(app).get(`${REPORTS}/attendance?period=ACROSS_TIME&groupId=not-a-uuid`).set(authA)); // 400
    api.conforms(await request(app).get(`${REPORTS}/attendance?period=ACROSS_TIME&studentId=not-a-uuid`).set(authA)); // 400
    for (const filter of [`groupId=${group.id}`, `studentId=${student.id}`, `schoolId=${schoolA.id}`]) {
      const outside = api.conforms(await request(app).get(`${REPORTS}/attendance?period=ACROSS_TIME&${filter}`).set(authB));
      expect(outside.status).toBe(403);
      expect(outside.body.error.code).toBe('REPORT_SCOPE_FORBIDDEN');
    }
    const noReport = api.conforms(await request(app).get(`${REPORTS}/attendance?period=ACROSS_TIME`).set(authC)); // a Collector has no attendance report
    expect(noReport.status).toBe(403);
    expect(noReport.body.error.code).toBe('REPORT_NOT_ALLOWED');
    api.conforms(await request(app).get(`${REPORTS}/attendance?period=ACROSS_TIME`)); // 401

    // ---- CSV
    const csv = api.conforms(await request(app).get(`${REPORTS}/attendance/csv?period=ACROSS_TIME`).set(authA));
    expect(csv.status).toBe(200);
    expect(csv.headers['content-disposition']).toContain('attendance-report-across-time.csv');
    expect(csv.text).toContain('حلقة الفجر');
    api.conforms(await request(app).get(`${REPORTS}/attendance/csv?period=ACROSS_TIME&groupId=${group.id}`).set(authB)); // 403
    api.conforms(await request(app).get(`${REPORTS}/attendance/csv`).set(authA)); // 400
    api.conforms(await request(app).get(`${REPORTS}/attendance/csv?period=ACROSS_TIME`)); // 401

    // ---- Excel
    const xlsx = api.conforms(await request(app).get(`${REPORTS}/attendance/xlsx?period=THIS_MONTH`).set(authA));
    expect(xlsx.status).toBe(200);
    expect(xlsx.headers['content-type']).toContain('spreadsheetml');
    api.conforms(await request(app).get(`${REPORTS}/attendance/xlsx?period=ACROSS_TIME&groupId=${group.id}`).set(authB)); // 403
    api.conforms(await request(app).get(`${REPORTS}/attendance/xlsx?period=FOREVER`).set(authA)); // 400
    api.conforms(await request(app).get(`${REPORTS}/attendance/xlsx?period=ACROSS_TIME`)); // 401
  });

  it('memorization report: JSON, CSV and Excel, with their error responses', async () => {
    const { app, t, login, firstLoginAndChange, recordMemorization } = await createReportsApi();
    const schoolA = await t.newSchool('مدرسة النور');
    const schoolB = await t.newSchool('مدرسة الهدى');
    const managerA = await t.newSchoolManager(schoolA.id);
    const managerB = await t.newSchoolManager(schoolB.id);
    const group = await t.newGroup(schoolA.id, managerA.id, 'حلقة الفجر');
    const parent = await t.newParent(schoolA.id, managerA.id);
    const student = await t.registerStudent(schoolA.id, parent.id, managerA.id, { joinDate: '2026-09-01' });
    await t.groups.assignStudent(group.id, student.id, managerA.id);
    const record = (matches: boolean | null, sessionStart: string) => recordMemorization({ schoolId: schoolA.id, groupId: group.id, studentId: student.id, matches, sessionStart });
    record(false, '2026-08-20T09:00:00Z'); // before the join date: never reported
    record(true, '2026-10-05T09:00:00Z');
    record(false, '2026-10-12T09:00:00Z');
    record(null, '2026-11-02T09:00:00Z');
    t.setNow('2026-11-10T09:00:00Z');
    const collector = await t.newCollector(schoolA.id, managerA.id);
    const authA = await login(managerA);
    const authB = await login(managerB);
    const authOrg = await login(t.orgAdmin);
    const { auth: authC } = await firstLoginAndChange(collector);

    // ---- JSON: the numbers follow Module 27's stored data, and nothing before the join date
    const all = api.conforms(await request(app).get(`${REPORTS}/memorization?period=ACROSS_TIME`).set(authA));
    expect(all.status).toBe(200);
    expect(all.body.data.rows).toEqual([
      { studentId: student.id, studentName: student.fullName, schoolId: schoolA.id, schoolName: 'مدرسة النور', groupId: group.id, groupName: 'حلقة الفجر', records: 3, fulfilled: 1, notFulfilled: 1, unscheduled: 1 },
    ]);
    expect(all.body.data.totals).toEqual({ records: 3, fulfilled: 1, notFulfilled: 1, unscheduled: 1 });
    expect(all.body.meta).toEqual({ page: 1, pageSize: 20, total: 1, totalPages: 1 }); // standard pagination: default 20 rows per page
    const beyond = api.conforms(await request(app).get(`${REPORTS}/memorization?period=ACROSS_TIME&page=2`).set(authA));
    expect(beyond.body.data.rows).toEqual([]);
    expect(beyond.body.data.totals).toEqual({ records: 3, fulfilled: 1, notFulfilled: 1, unscheduled: 1 }); // totals cover the whole report, not the page
    expect(beyond.body.meta).toEqual({ page: 2, pageSize: 20, total: 1, totalPages: 1 });
    const capped = api.conforms(await request(app).get(`${REPORTS}/memorization?period=ACROSS_TIME&pageSize=500`).set(authA));
    expect(capped.body.meta.pageSize).toBe(100); // above 100 is capped, not rejected
    for (const bad of ['page=0', 'page=abc', 'page=1.5', 'pageSize=0', 'pageSize=-1']) {
      const refused = api.conforms(await request(app).get(`${REPORTS}/memorization?period=ACROSS_TIME&${bad}`).set(authA));
      expect(refused.status, bad).toBe(400);
      expect(JSON.stringify(refused.body), bad).toContain(bad.startsWith('page=') ? 'INVALID_PAGE' : 'INVALID_PAGE_SIZE');
    }
    const thisMonth = api.conforms(await request(app).get(`${REPORTS}/memorization?period=THIS_MONTH&groupId=${group.id}`).set(authA));
    expect(thisMonth.body.data.totals).toEqual({ records: 1, fulfilled: 0, notFulfilled: 0, unscheduled: 1 });
    const custom = api.conforms(await request(app).get(`${REPORTS}/memorization?period=CUSTOM&startDate=2026-10-01&endDate=2026-10-31&studentId=${student.id}`).set(authA));
    expect(custom.body.data.totals).toEqual({ records: 2, fulfilled: 1, notFulfilled: 1, unscheduled: 0 });
    // the Organization Manager reports on every school of their organization; School Manager B sees nothing of school A
    expect(api.conforms(await request(app).get(`${REPORTS}/memorization?period=ACROSS_TIME`).set(authOrg)).body.data.rows).toHaveLength(1);
    expect(api.conforms(await request(app).get(`${REPORTS}/memorization?period=ACROSS_TIME`).set(authB)).body.data.rows).toEqual([]);

    // ---- JSON: errors
    api.conforms(await request(app).get(`${REPORTS}/memorization`).set(authA)); // 400 period missing
    api.conforms(await request(app).get(`${REPORTS}/memorization?period=FOREVER`).set(authA)); // 400 INVALID_REPORT_PERIOD
    api.conforms(await request(app).get(`${REPORTS}/memorization?period=ACROSS_TIME&groupId=not-a-uuid`).set(authA)); // 400
    api.conforms(await request(app).get(`${REPORTS}/memorization?period=ACROSS_TIME&studentId=not-a-uuid`).set(authA)); // 400
    for (const filter of [`groupId=${group.id}`, `studentId=${student.id}`, `schoolId=${schoolA.id}`]) {
      const outside = api.conforms(await request(app).get(`${REPORTS}/memorization?period=ACROSS_TIME&${filter}`).set(authB));
      expect(outside.status).toBe(403);
      expect(outside.body.error.code).toBe('REPORT_SCOPE_FORBIDDEN');
    }
    const noReport = api.conforms(await request(app).get(`${REPORTS}/memorization?period=ACROSS_TIME`).set(authC)); // a Collector has no memorization report
    expect(noReport.status).toBe(403);
    expect(noReport.body.error.code).toBe('REPORT_NOT_ALLOWED');
    api.conforms(await request(app).get(`${REPORTS}/memorization?period=ACROSS_TIME`)); // 401

    // ---- CSV
    const csv = api.conforms(await request(app).get(`${REPORTS}/memorization/csv?period=ACROSS_TIME`).set(authA));
    expect(csv.status).toBe(200);
    expect(csv.headers['content-disposition']).toContain('memorization-report-across-time.csv');
    expect(csv.text).toContain('حلقة الفجر');
    api.conforms(await request(app).get(`${REPORTS}/memorization/csv?period=ACROSS_TIME&groupId=${group.id}`).set(authB)); // 403
    api.conforms(await request(app).get(`${REPORTS}/memorization/csv`).set(authA)); // 400
    api.conforms(await request(app).get(`${REPORTS}/memorization/csv?period=ACROSS_TIME`)); // 401

    // ---- Excel
    const xlsx = api.conforms(await request(app).get(`${REPORTS}/memorization/xlsx?period=THIS_MONTH`).set(authA));
    expect(xlsx.status).toBe(200);
    expect(xlsx.headers['content-type']).toContain('spreadsheetml');
    api.conforms(await request(app).get(`${REPORTS}/memorization/xlsx?period=ACROSS_TIME&groupId=${group.id}`).set(authB)); // 403
    api.conforms(await request(app).get(`${REPORTS}/memorization/xlsx?period=FOREVER`).set(authA)); // 400
    api.conforms(await request(app).get(`${REPORTS}/memorization/xlsx?period=ACROSS_TIME`)); // 401
  });

  it('revision report: JSON, CSV and Excel, with their error responses', async () => {
    const { app, t, login, firstLoginAndChange, recordRevision } = await createReportsApi();
    const schoolA = await t.newSchool('مدرسة النور');
    const schoolB = await t.newSchool('مدرسة الهدى');
    const managerA = await t.newSchoolManager(schoolA.id);
    const managerB = await t.newSchoolManager(schoolB.id);
    const group = await t.newGroup(schoolA.id, managerA.id, 'حلقة الفجر');
    const parent = await t.newParent(schoolA.id, managerA.id);
    const student = await t.registerStudent(schoolA.id, parent.id, managerA.id, { joinDate: '2026-09-01' });
    await t.groups.assignStudent(group.id, student.id, managerA.id);
    const record = (matches: boolean | null, sessionStart: string) => recordRevision({ schoolId: schoolA.id, groupId: group.id, studentId: student.id, matches, sessionStart });
    record(false, '2026-08-20T09:00:00Z'); // before the join date: never reported
    record(true, '2026-10-05T09:00:00Z');
    record(false, '2026-10-12T09:00:00Z');
    record(null, '2026-11-02T09:00:00Z');
    t.setNow('2026-11-10T09:00:00Z');
    const collector = await t.newCollector(schoolA.id, managerA.id);
    const authA = await login(managerA);
    const authB = await login(managerB);
    const authOrg = await login(t.orgAdmin);
    const { auth: authC } = await firstLoginAndChange(collector);

    // ---- JSON: the numbers follow Module 28's stored data, and nothing before the join date
    const all = api.conforms(await request(app).get(`${REPORTS}/revision?period=ACROSS_TIME`).set(authA));
    expect(all.status).toBe(200);
    expect(all.body.data.rows).toEqual([
      { studentId: student.id, studentName: student.fullName, schoolId: schoolA.id, schoolName: 'مدرسة النور', groupId: group.id, groupName: 'حلقة الفجر', records: 3, fulfilled: 1, notFulfilled: 1, unscheduled: 1 },
    ]);
    expect(all.body.data.totals).toEqual({ records: 3, fulfilled: 1, notFulfilled: 1, unscheduled: 1 });
    expect(all.body.meta).toEqual({ page: 1, pageSize: 20, total: 1, totalPages: 1 }); // standard pagination: default 20 rows per page
    const beyond = api.conforms(await request(app).get(`${REPORTS}/revision?period=ACROSS_TIME&page=2`).set(authA));
    expect(beyond.body.data.rows).toEqual([]);
    expect(beyond.body.data.totals).toEqual({ records: 3, fulfilled: 1, notFulfilled: 1, unscheduled: 1 }); // totals cover the whole report, not the page
    expect(beyond.body.meta).toEqual({ page: 2, pageSize: 20, total: 1, totalPages: 1 });
    const capped = api.conforms(await request(app).get(`${REPORTS}/revision?period=ACROSS_TIME&pageSize=500`).set(authA));
    expect(capped.body.meta.pageSize).toBe(100); // above 100 is capped, not rejected
    for (const bad of ['page=0', 'page=abc', 'page=1.5', 'pageSize=0', 'pageSize=-1']) {
      const refused = api.conforms(await request(app).get(`${REPORTS}/revision?period=ACROSS_TIME&${bad}`).set(authA));
      expect(refused.status, bad).toBe(400);
      expect(JSON.stringify(refused.body), bad).toContain(bad.startsWith('page=') ? 'INVALID_PAGE' : 'INVALID_PAGE_SIZE');
    }
    const thisMonth = api.conforms(await request(app).get(`${REPORTS}/revision?period=THIS_MONTH&groupId=${group.id}`).set(authA));
    expect(thisMonth.body.data.totals).toEqual({ records: 1, fulfilled: 0, notFulfilled: 0, unscheduled: 1 });
    const custom = api.conforms(await request(app).get(`${REPORTS}/revision?period=CUSTOM&startDate=2026-10-01&endDate=2026-10-31&studentId=${student.id}`).set(authA));
    expect(custom.body.data.totals).toEqual({ records: 2, fulfilled: 1, notFulfilled: 1, unscheduled: 0 });
    // the Organization Manager reports on every school of their organization; School Manager B sees nothing of school A
    expect(api.conforms(await request(app).get(`${REPORTS}/revision?period=ACROSS_TIME`).set(authOrg)).body.data.rows).toHaveLength(1);
    expect(api.conforms(await request(app).get(`${REPORTS}/revision?period=ACROSS_TIME`).set(authB)).body.data.rows).toEqual([]);

    // ---- JSON: errors
    api.conforms(await request(app).get(`${REPORTS}/revision`).set(authA)); // 400 period missing
    api.conforms(await request(app).get(`${REPORTS}/revision?period=FOREVER`).set(authA)); // 400 INVALID_REPORT_PERIOD
    api.conforms(await request(app).get(`${REPORTS}/revision?period=ACROSS_TIME&groupId=not-a-uuid`).set(authA)); // 400
    api.conforms(await request(app).get(`${REPORTS}/revision?period=ACROSS_TIME&studentId=not-a-uuid`).set(authA)); // 400
    for (const filter of [`groupId=${group.id}`, `studentId=${student.id}`, `schoolId=${schoolA.id}`]) {
      const outside = api.conforms(await request(app).get(`${REPORTS}/revision?period=ACROSS_TIME&${filter}`).set(authB));
      expect(outside.status).toBe(403);
      expect(outside.body.error.code).toBe('REPORT_SCOPE_FORBIDDEN');
    }
    const noReport = api.conforms(await request(app).get(`${REPORTS}/revision?period=ACROSS_TIME`).set(authC)); // a Collector has no revision report
    expect(noReport.status).toBe(403);
    expect(noReport.body.error.code).toBe('REPORT_NOT_ALLOWED');
    api.conforms(await request(app).get(`${REPORTS}/revision?period=ACROSS_TIME`)); // 401

    // ---- CSV
    const csv = api.conforms(await request(app).get(`${REPORTS}/revision/csv?period=ACROSS_TIME`).set(authA));
    expect(csv.status).toBe(200);
    expect(csv.headers['content-disposition']).toContain('revision-report-across-time.csv');
    expect(csv.text).toContain('حلقة الفجر');
    api.conforms(await request(app).get(`${REPORTS}/revision/csv?period=ACROSS_TIME&groupId=${group.id}`).set(authB)); // 403
    api.conforms(await request(app).get(`${REPORTS}/revision/csv`).set(authA)); // 400
    api.conforms(await request(app).get(`${REPORTS}/revision/csv?period=ACROSS_TIME`)); // 401

    // ---- Excel
    const xlsx = api.conforms(await request(app).get(`${REPORTS}/revision/xlsx?period=THIS_MONTH`).set(authA));
    expect(xlsx.status).toBe(200);
    expect(xlsx.headers['content-type']).toContain('spreadsheetml');
    api.conforms(await request(app).get(`${REPORTS}/revision/xlsx?period=ACROSS_TIME&groupId=${group.id}`).set(authB)); // 403
    api.conforms(await request(app).get(`${REPORTS}/revision/xlsx?period=FOREVER`).set(authA)); // 400
    api.conforms(await request(app).get(`${REPORTS}/revision/xlsx?period=ACROSS_TIME`)); // 401
  });

  it('evaluation report: JSON, CSV and Excel, with their error responses', async () => {
    const { app, t, login, firstLoginAndChange, recordEvaluation } = await createReportsApi();
    const schoolA = await t.newSchool('مدرسة النور');
    const schoolB = await t.newSchool('مدرسة الهدى');
    const managerA = await t.newSchoolManager(schoolA.id);
    const managerB = await t.newSchoolManager(schoolB.id);
    const group = await t.newGroup(schoolA.id, managerA.id, 'حلقة الفجر');
    const parent = await t.newParent(schoolA.id, managerA.id);
    const student = await t.registerStudent(schoolA.id, parent.id, managerA.id, { joinDate: '2026-09-01' });
    await t.groups.assignStudent(group.id, student.id, managerA.id);
    const record = (scores: Partial<Record<'MEMORIZATION' | 'REVISION' | 'PERFORMANCE' | 'TAJWEED', number>>, sessionStart: string) =>
      recordEvaluation({ schoolId: schoolA.id, groupId: group.id, studentId: student.id, recordedBy: '00000000-0000-0000-0000-0000000000aa', sessionStart, scores });
    record({ MEMORIZATION: 1 }, '2026-08-20T09:00:00Z'); // before the join date: never reported
    record({ MEMORIZATION: 8 }, '2026-10-05T09:00:00Z');
    record({ MEMORIZATION: 7, PERFORMANCE: 9 }, '2026-10-12T09:00:00Z');
    record({ PERFORMANCE: 6 }, '2026-11-02T09:00:00Z');
    t.setNow('2026-11-10T09:00:00Z');
    const collector = await t.newCollector(schoolA.id, managerA.id);
    const authA = await login(managerA);
    const authB = await login(managerB);
    const authOrg = await login(t.orgAdmin);
    const { auth: authC } = await firstLoginAndChange(collector);

    // ---- JSON: the numbers follow Module 29's stored data, and nothing before the join date
    const NO_SCORE = { count: 0, average: null };
    const ALL_TIME_SCORES = { MEMORIZATION: { count: 2, average: 7.5 }, REVISION: NO_SCORE, PERFORMANCE: { count: 2, average: 7.5 }, TAJWEED: NO_SCORE }; // 8 and 7; 9 and 6 (the pre-join 1 is never counted)
    const all = api.conforms(await request(app).get(`${REPORTS}/evaluation?period=ACROSS_TIME`).set(authA));
    expect(all.status).toBe(200);
    expect(all.body.data.rows).toEqual([
      { studentId: student.id, studentName: student.fullName, schoolId: schoolA.id, schoolName: 'مدرسة النور', groupId: group.id, groupName: 'حلقة الفجر', evaluations: 3, scores: ALL_TIME_SCORES },
    ]);
    expect(all.body.data.totals).toEqual({ evaluations: 3, scores: ALL_TIME_SCORES });
    expect(all.body.meta).toEqual({ page: 1, pageSize: 20, total: 1, totalPages: 1 }); // standard pagination: default 20 rows per page
    const beyond = api.conforms(await request(app).get(`${REPORTS}/evaluation?period=ACROSS_TIME&page=2`).set(authA));
    expect(beyond.body.data.rows).toEqual([]);
    expect(beyond.body.data.totals).toEqual({ evaluations: 3, scores: ALL_TIME_SCORES }); // totals cover the whole report, not the page
    expect(beyond.body.meta).toEqual({ page: 2, pageSize: 20, total: 1, totalPages: 1 });
    const capped = api.conforms(await request(app).get(`${REPORTS}/evaluation?period=ACROSS_TIME&pageSize=500`).set(authA));
    expect(capped.body.meta.pageSize).toBe(100); // above 100 is capped, not rejected
    for (const bad of ['page=0', 'page=abc', 'page=1.5', 'pageSize=0', 'pageSize=-1']) {
      const refused = api.conforms(await request(app).get(`${REPORTS}/evaluation?period=ACROSS_TIME&${bad}`).set(authA));
      expect(refused.status, bad).toBe(400);
      expect(JSON.stringify(refused.body), bad).toContain(bad.startsWith('page=') ? 'INVALID_PAGE' : 'INVALID_PAGE_SIZE');
    }
    const thisMonth = api.conforms(await request(app).get(`${REPORTS}/evaluation?period=THIS_MONTH&groupId=${group.id}`).set(authA));
    expect(thisMonth.body.data.totals).toEqual({ evaluations: 1, scores: { MEMORIZATION: NO_SCORE, REVISION: NO_SCORE, PERFORMANCE: { count: 1, average: 6 }, TAJWEED: NO_SCORE } });
    const custom = api.conforms(await request(app).get(`${REPORTS}/evaluation?period=CUSTOM&startDate=2026-10-01&endDate=2026-10-31&studentId=${student.id}`).set(authA));
    expect(custom.body.data.totals).toEqual({ evaluations: 2, scores: { MEMORIZATION: { count: 2, average: 7.5 }, REVISION: NO_SCORE, PERFORMANCE: { count: 1, average: 9 }, TAJWEED: NO_SCORE } });
    // the Organization Manager reports on every school of their organization; School Manager B sees nothing of school A
    expect(api.conforms(await request(app).get(`${REPORTS}/evaluation?period=ACROSS_TIME`).set(authOrg)).body.data.rows).toHaveLength(1);
    expect(api.conforms(await request(app).get(`${REPORTS}/evaluation?period=ACROSS_TIME`).set(authB)).body.data.rows).toEqual([]);

    // ---- JSON: errors
    api.conforms(await request(app).get(`${REPORTS}/evaluation`).set(authA)); // 400 period missing
    api.conforms(await request(app).get(`${REPORTS}/evaluation?period=FOREVER`).set(authA)); // 400 INVALID_REPORT_PERIOD
    api.conforms(await request(app).get(`${REPORTS}/evaluation?period=ACROSS_TIME&groupId=not-a-uuid`).set(authA)); // 400
    api.conforms(await request(app).get(`${REPORTS}/evaluation?period=ACROSS_TIME&studentId=not-a-uuid`).set(authA)); // 400
    for (const filter of [`groupId=${group.id}`, `studentId=${student.id}`, `schoolId=${schoolA.id}`]) {
      const outside = api.conforms(await request(app).get(`${REPORTS}/evaluation?period=ACROSS_TIME&${filter}`).set(authB));
      expect(outside.status).toBe(403);
      expect(outside.body.error.code).toBe('REPORT_SCOPE_FORBIDDEN');
    }
    const noReport = api.conforms(await request(app).get(`${REPORTS}/evaluation?period=ACROSS_TIME`).set(authC)); // a Collector has no evaluation report
    expect(noReport.status).toBe(403);
    expect(noReport.body.error.code).toBe('REPORT_NOT_ALLOWED');
    api.conforms(await request(app).get(`${REPORTS}/evaluation?period=ACROSS_TIME`)); // 401

    // ---- CSV
    const csv = api.conforms(await request(app).get(`${REPORTS}/evaluation/csv?period=ACROSS_TIME`).set(authA));
    expect(csv.status).toBe(200);
    expect(csv.headers['content-disposition']).toContain('evaluation-report-across-time.csv');
    expect(csv.text).toContain('حلقة الفجر');
    api.conforms(await request(app).get(`${REPORTS}/evaluation/csv?period=ACROSS_TIME&groupId=${group.id}`).set(authB)); // 403
    api.conforms(await request(app).get(`${REPORTS}/evaluation/csv`).set(authA)); // 400
    api.conforms(await request(app).get(`${REPORTS}/evaluation/csv?period=ACROSS_TIME`)); // 401

    // ---- Excel
    const xlsx = api.conforms(await request(app).get(`${REPORTS}/evaluation/xlsx?period=THIS_MONTH`).set(authA));
    expect(xlsx.status).toBe(200);
    expect(xlsx.headers['content-type']).toContain('spreadsheetml');
    api.conforms(await request(app).get(`${REPORTS}/evaluation/xlsx?period=ACROSS_TIME&groupId=${group.id}`).set(authB)); // 403
    api.conforms(await request(app).get(`${REPORTS}/evaluation/xlsx?period=FOREVER`).set(authA)); // 400
    api.conforms(await request(app).get(`${REPORTS}/evaluation/xlsx?period=ACROSS_TIME`)); // 401
  });

  it('student report: JSON, CSV and Excel, with their error responses', async () => {
    const { app, t, login, firstLoginAndChange, recordAttendance, recordMemorization, recordEvaluation, recordExam } = await createReportsApi();
    const schoolA = await t.newSchool('مدرسة النور');
    const schoolB = await t.newSchool('مدرسة الهدى');
    const managerA = await t.newSchoolManager(schoolA.id);
    const managerB = await t.newSchoolManager(schoolB.id);
    const group = await t.newGroup(schoolA.id, managerA.id, 'حلقة الفجر');
    const parent = await t.newParent(schoolA.id, managerA.id);
    const student = await t.registerStudent(schoolA.id, parent.id, managerA.id, { joinDate: '2026-09-01' });
    await t.groups.assignStudent(group.id, student.id, managerA.id);
    const ids = { schoolId: schoolA.id, groupId: group.id };
    recordAttendance({ ...ids, subjectType: 'STUDENT', subjectId: student.id, status: 'PRESENT', date: '2026-10-05' });
    recordAttendance({ ...ids, subjectType: 'STUDENT', subjectId: student.id, status: 'ABSENT', date: '2026-10-06' });
    recordAttendance({ ...ids, subjectType: 'STUDENT', subjectId: student.id, status: 'PRESENT', date: '2026-08-20' }); // before the join date: never reported
    recordMemorization({ ...ids, studentId: student.id, matches: true, sessionStart: '2026-10-05T09:00:00Z' });
    recordMemorization({ ...ids, studentId: student.id, matches: false, sessionStart: '2026-10-06T09:00:00Z' });
    recordMemorization({ ...ids, studentId: student.id, matches: null, sessionStart: '2026-11-02T09:00:00Z' });
    recordMemorization({ ...ids, studentId: student.id, matches: true, sessionStart: '2026-08-21T09:00:00Z' }); // before the join date
    recordEvaluation({ ...ids, studentId: student.id, recordedBy: '00000000-0000-0000-0000-0000000000aa', sessionStart: '2026-10-05T09:00:00Z', scores: { MEMORIZATION: 8 } });
    recordExam({ ...ids, studentId: student.id, startAt: '2026-10-12T07:00:00Z', outcome: 'EXAMINED', scores: [9, 8.5], questionCount: 2, maxScore: 10 });
    recordExam({ ...ids, studentId: student.id, startAt: '2026-11-02T07:00:00Z', outcome: 'ABSENT', questionCount: 2, maxScore: 10 });
    t.setNow('2026-10-10T09:00:00Z');
    await t.subscriptions.createMonthlySubscriptions(schoolA.id, managerA.id);
    const octSub = (await t.subscriptionRepo.findByStudentMonth(student.id, '2026-10'))!.snapshot.id;
    await t.payments.recordPayment(octSub, managerA.id);
    t.setNow('2026-11-10T09:00:00Z');
    await t.subscriptions.createMonthlySubscriptions(schoolA.id, managerA.id);
    const collector = await t.newCollector(schoolA.id, managerA.id);
    const authA = await login(managerA);
    const authB = await login(managerB);
    const authOrg = await login(t.orgAdmin);
    const { auth: authC } = await firstLoginAndChange(collector);
    const url = (suffix: string, query: string) => `${REPORTS}/student${suffix}?${query}`;

    // ---- JSON: seven sections, every number follows the owning modules' stored data, nothing before the join date
    const all = api.conforms(await request(app).get(url('', `period=ACROSS_TIME&studentId=${student.id}`)).set(authA));
    expect(all.status).toBe(200);
    const report = all.body.data;
    expect(report.type).toBe('STUDENT');
    expect(report.student).toEqual({ id: student.id, name: student.fullName, schoolId: schoolA.id, schoolName: 'مدرسة النور', joinDate: '2026-09-01' });
    expect(report.effectiveStartDate).toBe('2026-09-01');
    expect(report.sections.attendance.totals).toEqual({ present: 1, absent: 1, total: 2 });
    expect(report.sections.attendance.rows).toEqual([{ groupId: group.id, groupName: 'حلقة الفجر', present: 1, absent: 1, total: 2 }]);
    expect(report.sections.memorization.totals).toEqual({ records: 3, fulfilled: 1, notFulfilled: 1, unscheduled: 1 });
    expect(report.sections.revision.totals).toEqual({ records: 0, fulfilled: 0, notFulfilled: 0, unscheduled: 0 });
    expect(report.sections.evaluations.totals.evaluations).toBe(1);
    expect(report.sections.examResults.counts).toEqual({ examined: 1, absent: 1, total: 2 });
    expect(report.sections.examResults.rows.map((r: { outcome: string; scores: number[]; total: number | null; maxTotal: number; examDate: string }) => [r.examDate, r.outcome, r.scores, r.total, r.maxTotal])).toEqual([
      ['2026-10-12', 'EXAMINED', [9, 8.5], 17.5, 20],
      ['2026-11-02', 'ABSENT', [], null, 20],
    ]);
    expect(report.sections.subscriptions.rows).toEqual([{ month: '2026-10', status: 'PAID' }, { month: '2026-11', status: 'UNPAID' }]);
    expect(report.sections.subscriptions.totals).toEqual({ paid: 1, unpaid: 1, waived: 0, total: 2 });
    expect(report.sections.groupHistory.rows).toHaveLength(1);
    expect(report.sections.groupHistory.rows[0]).toMatchObject({ groupId: group.id, groupName: 'حلقة الفجر', current: true });
    expect(all.body.meta).toEqual({ page: 1, pageSize: 20, total: 2, totalPages: 1 }); // standard pagination of the EXAM list

    // ---- only the exam list is paginated
    const firstPage = api.conforms(await request(app).get(url('', `period=ACROSS_TIME&studentId=${student.id}&pageSize=1`)).set(authA));
    expect(firstPage.body.data.sections.examResults.rows).toHaveLength(1);
    expect(firstPage.body.data.sections.examResults.counts.total).toBe(2);
    expect(firstPage.body.data.sections.attendance.totals.total).toBe(2); // the other sections are complete
    expect(firstPage.body.meta).toEqual({ page: 1, pageSize: 1, total: 2, totalPages: 2 });
    expect(api.conforms(await request(app).get(url('', `period=ACROSS_TIME&studentId=${student.id}&pageSize=500`)).set(authA)).body.meta.pageSize).toBe(100);
    for (const bad of ['page=0', 'page=abc', 'pageSize=0', 'pageSize=-1']) {
      const refused = api.conforms(await request(app).get(url('', `period=ACROSS_TIME&studentId=${student.id}&${bad}`)).set(authA));
      expect(refused.status, bad).toBe(400);
      expect(JSON.stringify(refused.body), bad).toContain(bad.startsWith('page=') ? 'INVALID_PAGE' : 'INVALID_PAGE_SIZE');
    }

    // ---- periods: the exam belongs to the period by its start date; the months follow the period
    const thisMonth = api.conforms(await request(app).get(url('', `period=THIS_MONTH&studentId=${student.id}`)).set(authA)).body.data;
    expect(thisMonth.effectiveStartDate).toBe('2026-11-01');
    expect(thisMonth.sections.examResults.rows.map((r: { outcome: string }) => r.outcome)).toEqual(['ABSENT']);
    expect(thisMonth.sections.subscriptions.rows).toEqual([{ month: '2026-11', status: 'UNPAID' }]);
    const october = api.conforms(await request(app).get(url('', `period=CUSTOM&startDate=2026-10-01&endDate=2026-10-31&studentId=${student.id}`)).set(authA)).body.data;
    expect(october.sections.examResults.counts).toEqual({ examined: 1, absent: 0, total: 1 });
    expect(october.sections.subscriptions.rows).toEqual([{ month: '2026-10', status: 'PAID' }]);
    // the Organization Manager reports on every school of their organization; School Manager B sees nothing of school A
    expect(api.conforms(await request(app).get(url('', `period=ACROSS_TIME&studentId=${student.id}`)).set(authOrg)).body.data.sections.subscriptions).toBeDefined();

    // ---- JSON: errors (a student outside the scope and one that does not exist are the SAME 403)
    api.conforms(await request(app).get(url('', `period=ACROSS_TIME`)).set(authA)); // 400 studentId missing
    api.conforms(await request(app).get(url('', `studentId=${student.id}`)).set(authA)); // 400 period missing
    api.conforms(await request(app).get(url('', `period=FOREVER&studentId=${student.id}`)).set(authA)); // 400 INVALID_REPORT_PERIOD
    api.conforms(await request(app).get(url('', `period=ACROSS_TIME&studentId=not-a-uuid`)).set(authA)); // 400
    for (const studentId of [student.id, '3f1b2c4d-5e6a-4b7c-8d9e-0a1b2c3d4e5f']) {
      const outside = api.conforms(await request(app).get(url('', `period=ACROSS_TIME&studentId=${studentId}`)).set(authB));
      expect(outside.status).toBe(403);
      expect(outside.body.error.code).toBe('REPORT_SCOPE_FORBIDDEN');
    }
    const noReport = api.conforms(await request(app).get(url('', `period=ACROSS_TIME&studentId=${student.id}`)).set(authC)); // a Collector has no student report
    expect(noReport.status).toBe(403);
    expect(noReport.body.error.code).toBe('REPORT_NOT_ALLOWED');
    api.conforms(await request(app).get(url('', `period=ACROSS_TIME&studentId=${student.id}`))); // 401

    // ---- CSV: one combined table with a section column; the complete report
    const csv = api.conforms(await request(app).get(url('/csv', `period=ACROSS_TIME&studentId=${student.id}`)).set(authA));
    expect(csv.status).toBe(200);
    expect(csv.headers['content-disposition']).toContain('student-report-across-time.csv');
    expect(csv.text).toContain('القسم');
    expect(csv.text).toContain('حلقة الفجر');
    expect(csv.text).toContain('2026-10-12');
    api.conforms(await request(app).get(url('/csv', `period=ACROSS_TIME&studentId=${student.id}`)).set(authB)); // 403
    api.conforms(await request(app).get(url('/csv', `period=ACROSS_TIME`)).set(authA)); // 400
    api.conforms(await request(app).get(url('/csv', `period=ACROSS_TIME&studentId=${student.id}`))); // 401

    // ---- Excel: one worksheet per visible section
    const xlsx = api.conforms(await request(app).get(url('/xlsx', `period=THIS_MONTH&studentId=${student.id}`)).set(authA));
    expect(xlsx.status).toBe(200);
    expect(xlsx.headers['content-type']).toContain('spreadsheetml');
    expect(xlsx.headers['content-disposition']).toContain('student-report-this-month.xlsx');
    api.conforms(await request(app).get(url('/xlsx', `period=ACROSS_TIME&studentId=${student.id}`)).set(authB)); // 403
    api.conforms(await request(app).get(url('/xlsx', `period=FOREVER&studentId=${student.id}`)).set(authA)); // 400
    api.conforms(await request(app).get(url('/xlsx', `period=ACROSS_TIME&studentId=${student.id}`))); // 401
  });

  it('parent report: JSON, CSV and Excel, with their error responses', async () => {
    const { app, t, login, firstLoginAndChange, recordAttendance, recordExam } = await createReportsApi();
    const schoolA = await t.newSchool('مدرسة النور');
    const schoolB = await t.newSchool('مدرسة الهدى');
    const managerA = await t.newSchoolManager(schoolA.id);
    const managerB = await t.newSchoolManager(schoolB.id);
    const group = await t.newGroup(schoolA.id, managerA.id, 'حلقة الفجر');
    const address = { kind: 'raw', text: 'المنيا / سمالوط / برمشا' } as const;
    const parentPhone = '01010002001';
    const parent = (await t.parents.registerParent({ schoolId: schoolA.id, name: 'أحمد محمد علي', phone: parentPhone, address }, managerA.id)).parent;
    const otherParent = (await t.parents.registerParent({ schoolId: schoolB.id, name: 'خالد سعيد علي', phone: '01010002002', address }, managerB.id)).parent;
    const omar = await t.registerStudent(schoolA.id, parent.id, managerA.id, { joinDate: '2026-09-01', fullName: 'عمر أحمد محمد' });
    const ziad = await t.registerStudent(schoolA.id, parent.id, managerA.id, { joinDate: '2026-09-01', fullName: 'زياد أحمد محمد' });
    await t.groups.assignStudent(group.id, omar.id, managerA.id);
    await t.groups.assignStudent(group.id, ziad.id, managerA.id);
    const ids = { schoolId: schoolA.id, groupId: group.id };
    recordAttendance({ ...ids, subjectType: 'STUDENT', subjectId: omar.id, status: 'PRESENT', date: '2026-10-05' });
    recordAttendance({ ...ids, subjectType: 'STUDENT', subjectId: omar.id, status: 'ABSENT', date: '2026-10-06' });
    recordExam({ ...ids, studentId: omar.id, startAt: '2026-10-12T07:00:00Z', outcome: 'EXAMINED', scores: [9, 8.5], questionCount: 2, maxScore: 10 });
    recordExam({ ...ids, studentId: ziad.id, startAt: '2026-10-12T07:00:00Z', outcome: 'ABSENT', questionCount: 2, maxScore: 10 });
    await t.students.archiveStudent(ziad.id, 'انتقل إلى مدينة أخرى', managerA.id); // an ARCHIVED child is still reported
    const collector = await t.newCollector(schoolA.id, managerA.id);
    const authA = await login(managerA);
    const authB = await login(managerB);
    const authOrg = await login(t.orgAdmin);
    const { auth: authParent } = await firstLoginAndChange({ phone: parentPhone, password: parentPhone.slice(-4) });
    const { auth: authC } = await firstLoginAndChange(collector);
    const url = (suffix: string, query: string) => `${REPORTS}/parent${suffix}?${query}`;

    // ---- JSON for a manager: the Parent header and one complete STUDENT report per child (the archived one included)
    const all = api.conforms(await request(app).get(url('', `period=ACROSS_TIME&parentId=${parent.id}`)).set(authA));
    expect(all.status).toBe(200);
    const report = all.body.data;
    expect(report.type).toBe('PARENT');
    expect(report.parent).toEqual({ id: parent.id, name: 'أحمد محمد علي', children: [{ id: ziad.id, name: 'زياد أحمد محمد' }, { id: omar.id, name: 'عمر أحمد محمد' }] });
    expect(JSON.stringify(report.parent)).not.toContain('0101000'); // no phone number
    expect(report.childReports.map((r: { type: string; student: { id: string } }) => [r.type, r.student.id])).toEqual([['STUDENT', ziad.id], ['STUDENT', omar.id]]);
    const omarReport = report.childReports.find((r: { student: { id: string } }) => r.student.id === omar.id);
    expect(omarReport.sections.attendance.totals).toEqual({ present: 1, absent: 1, total: 2 });
    expect(omarReport.sections.examResults.counts).toEqual({ examined: 1, absent: 0, total: 1 });
    const ziadReport = report.childReports.find((r: { student: { id: string } }) => r.student.id === ziad.id);
    expect(ziadReport.sections.examResults.counts).toEqual({ examined: 0, absent: 1, total: 1 });
    for (const child of report.childReports) expect(child.sections.subscriptions).toBeDefined(); // managers only
    expect(all.body.meta).toEqual({ page: 1, pageSize: 20, total: 2, totalPages: 1 }); // standard pagination of the CHILDREN

    // ---- only the children are paginated; the header always lists everyone
    const first = api.conforms(await request(app).get(url('', `period=ACROSS_TIME&parentId=${parent.id}&pageSize=1`)).set(authA));
    expect(first.body.data.childReports).toHaveLength(1);
    expect(first.body.data.parent.children).toHaveLength(2);
    expect(first.body.meta).toEqual({ page: 1, pageSize: 1, total: 2, totalPages: 2 });
    expect(api.conforms(await request(app).get(url('', `period=ACROSS_TIME&parentId=${parent.id}&pageSize=500`)).set(authA)).body.meta.pageSize).toBe(100);
    for (const bad of ['page=0', 'page=abc', 'pageSize=0', 'pageSize=-1']) {
      const refused = api.conforms(await request(app).get(url('', `period=ACROSS_TIME&parentId=${parent.id}&${bad}`)).set(authA));
      expect(refused.status, bad).toBe(400);
      expect(JSON.stringify(refused.body), bad).toContain(bad.startsWith('page=') ? 'INVALID_PAGE' : 'INVALID_PAGE_SIZE');
    }
    expect(api.conforms(await request(app).get(url('', `period=ACROSS_TIME&parentId=${parent.id}`)).set(authOrg)).body.data.childReports).toHaveLength(2);

    // ---- the Parent: their own report, never another Parent's, and no subscription section
    for (const query of ['period=ACROSS_TIME', `period=ACROSS_TIME&parentId=${parent.id}`]) {
      const own = api.conforms(await request(app).get(url('', query)).set(authParent));
      expect(own.status, query).toBe(200);
      expect(own.body.data.parent.id).toBe(parent.id);
      expect(own.body.data.childReports).toHaveLength(2);
      for (const child of own.body.data.childReports) expect('subscriptions' in child.sections).toBe(false);
    }
    const another = api.conforms(await request(app).get(url('', `period=ACROSS_TIME&parentId=${otherParent.id}`)).set(authParent));
    expect(another.status).toBe(403);
    expect(another.body.error.code).toBe('REPORT_SCOPE_FORBIDDEN');

    // ---- JSON: errors (a Parent outside the scope and one that does not exist are the SAME 403)
    api.conforms(await request(app).get(url('', `period=ACROSS_TIME`)).set(authA)); // 400: a manager must send parentId
    api.conforms(await request(app).get(url('', `parentId=${parent.id}`)).set(authA)); // 400 period missing
    api.conforms(await request(app).get(url('', `period=FOREVER&parentId=${parent.id}`)).set(authA)); // 400 INVALID_REPORT_PERIOD
    api.conforms(await request(app).get(url('', `period=ACROSS_TIME&parentId=not-a-uuid`)).set(authA)); // 400
    for (const parentId of [parent.id, '3f1b2c4d-5e6a-4b7c-8d9e-0a1b2c3d4e5f']) {
      const outside = api.conforms(await request(app).get(url('', `period=ACROSS_TIME&parentId=${parentId}`)).set(authB));
      expect(outside.status).toBe(403);
      expect(outside.body.error.code).toBe('REPORT_SCOPE_FORBIDDEN');
    }
    const noReport = api.conforms(await request(app).get(url('', `period=ACROSS_TIME&parentId=${parent.id}`)).set(authC)); // a Collector has no parent report
    expect(noReport.status).toBe(403);
    expect(noReport.body.error.code).toBe('REPORT_NOT_ALLOWED');
    api.conforms(await request(app).get(url('', `period=ACROSS_TIME&parentId=${parent.id}`))); // 401

    // ---- CSV: a Parent section first, then every child (the complete report)
    const csv = api.conforms(await request(app).get(url('/csv', `period=ACROSS_TIME&parentId=${parent.id}`)).set(authA));
    expect(csv.status).toBe(200);
    expect(csv.headers['content-disposition']).toContain('parent-report-across-time.csv');
    expect(csv.text).toContain('ولي الأمر');
    expect(csv.text).toContain('عمر أحمد محمد');
    expect(csv.text).toContain('زياد أحمد محمد');
    expect(csv.text).toContain('الاشتراكات'); // the managers' file has the subscription rows
    const parentCsv = api.conforms(await request(app).get(url('/csv', `period=ACROSS_TIME`)).set(authParent));
    expect(parentCsv.status).toBe(200);
    expect(parentCsv.text).toContain('عمر أحمد محمد');
    expect(parentCsv.text).not.toContain('الاشتراكات'); // never for a Parent
    api.conforms(await request(app).get(url('/csv', `period=ACROSS_TIME&parentId=${parent.id}`)).set(authB)); // 403
    api.conforms(await request(app).get(url('/csv', `period=ACROSS_TIME`)).set(authA)); // 400
    api.conforms(await request(app).get(url('/csv', `period=ACROSS_TIME&parentId=${parent.id}`))); // 401

    // ---- Excel: the STUDENT worksheets with the rows of every child
    const xlsx = api.conforms(await request(app).get(url('/xlsx', `period=THIS_MONTH&parentId=${parent.id}`)).set(authA));
    expect(xlsx.status).toBe(200);
    expect(xlsx.headers['content-type']).toContain('spreadsheetml');
    expect(xlsx.headers['content-disposition']).toContain('parent-report-this-month.xlsx');
    expect(api.conforms(await request(app).get(url('/xlsx', `period=ACROSS_TIME`)).set(authParent)).status).toBe(200);
    api.conforms(await request(app).get(url('/xlsx', `period=ACROSS_TIME&parentId=${parent.id}`)).set(authB)); // 403
    api.conforms(await request(app).get(url('/xlsx', `period=FOREVER&parentId=${parent.id}`)).set(authA)); // 400
    api.conforms(await request(app).get(url('/xlsx', `period=ACROSS_TIME&parentId=${parent.id}`))); // 401
  });

  it('group report: JSON, CSV and Excel, with their error responses', async () => {
    const { app, t, login, firstLoginAndChange, recordAttendance, recordMemorization, recordEvaluation, recordExam } = await createReportsApi();
    const schoolA = await t.newSchool('مدرسة النور');
    const schoolB = await t.newSchool('مدرسة الهدى');
    const managerA = await t.newSchoolManager(schoolA.id);
    const managerB = await t.newSchoolManager(schoolB.id);
    const group = await t.newGroup(schoolA.id, managerA.id, 'حلقة الفجر');
    const parentPhone = '01010002001';
    const parent = (await t.parents.registerParent({ schoolId: schoolA.id, name: 'أحمد محمد علي', phone: parentPhone, address: { kind: 'raw', text: 'المنيا / سمالوط / برمشا' } }, managerA.id)).parent;
    const ahmed = await t.registerStudent(schoolA.id, parent.id, managerA.id, { joinDate: '2026-09-01', fullName: 'أحمد أحمد محمد' });
    const bilal = await t.registerStudent(schoolA.id, parent.id, managerA.id, { joinDate: '2026-09-01', fullName: 'بلال أحمد محمد' });
    const ziad = await t.registerStudent(schoolA.id, parent.id, managerA.id, { joinDate: '2026-09-01', fullName: 'زياد أحمد محمد' });
    // The authoritative assignment history, seeded with real dates (the group service's own clock is not movable here): Ahmed and Ziad are in the group since 10 September, Bilal was in it until 20 October.
    const assign = (studentId: string, unassignedAt: string | null) =>
      t.groupRepo.assignments.push({
        id: `00000000-0000-4000-8000-${String(t.groupRepo.assignments.length + 1).padStart(12, '0')}`, groupId: group.id, studentId, schoolId: schoolA.id, organizationId: schoolA.organizationId,
        assignedAt: new Date('2026-09-10T08:00:00Z'), assignedBy: managerA.id, unassignedAt: unassignedAt ? new Date(unassignedAt) : null, unassignedBy: null, endReason: unassignedAt ? 'STUDENT_ARCHIVED' : null,
      });
    assign(ahmed.id, null);
    assign(bilal.id, '2026-10-20T08:00:00Z');
    assign(ziad.id, null);
    const ids = { schoolId: schoolA.id, groupId: group.id };
    recordAttendance({ ...ids, subjectType: 'STUDENT', subjectId: ahmed.id, status: 'PRESENT', date: '2026-10-05' });
    recordAttendance({ ...ids, subjectType: 'STUDENT', subjectId: ahmed.id, status: 'ABSENT', date: '2026-10-06' });
    recordAttendance({ ...ids, subjectType: 'TEACHER', subjectId: '00000000-0000-0000-0000-0000000000b1', status: 'PRESENT', date: '2026-10-05' });
    recordAttendance({ ...ids, subjectType: 'TEACHER', subjectId: '00000000-0000-0000-0000-0000000000b1', status: 'ABSENT', date: '2026-10-06' });
    recordMemorization({ ...ids, studentId: ahmed.id, matches: true, sessionStart: '2026-10-05T09:00:00Z' });
    recordMemorization({ ...ids, studentId: ahmed.id, matches: false, sessionStart: '2026-10-06T09:00:00Z' });
    recordEvaluation({ ...ids, studentId: ahmed.id, recordedBy: '00000000-0000-0000-0000-0000000000aa', sessionStart: '2026-10-05T09:00:00Z', scores: { MEMORIZATION: 8 } });
    recordExam({ ...ids, studentId: ahmed.id, startAt: '2026-10-12T07:00:00Z', outcome: 'EXAMINED', scores: [9, 8.5], questionCount: 2, maxScore: 10 });
    recordExam({ ...ids, studentId: bilal.id, startAt: '2026-10-12T07:00:00Z', outcome: 'ABSENT', questionCount: 2, maxScore: 10 });
    await t.students.archiveStudent(bilal.id, 'انتقل إلى مدينة أخرى', managerA.id); // archived: left the group on 20 October but stays in the history
    t.setNow('2026-11-18T10:00:00Z');
    const collector = await t.newCollector(schoolA.id, managerA.id);
    const authA = await login(managerA);
    const authB = await login(managerB);
    const authOrg = await login(t.orgAdmin);
    const { auth: authParent } = await firstLoginAndChange({ phone: parentPhone, password: parentPhone.slice(-4) });
    const { auth: authC } = await firstLoginAndChange(collector);
    const url = (suffix: string, query: string) => `${REPORTS}/group${suffix}?${query}`;

    // ---- JSON: header, the whole historical roster (the archived student and the one without any activity included), totals over everyone, the Teacher's attendance for a manager
    const all = api.conforms(await request(app).get(url('', `period=ACROSS_TIME&groupId=${group.id}`)).set(authA));
    expect(all.status).toBe(200);
    const report = all.body.data;
    expect(report.type).toBe('GROUP');
    expect(report.group).toEqual({ id: group.id, name: 'حلقة الفجر', schoolId: schoolA.id, schoolName: 'مدرسة النور', learningMode: 'GROUP', status: 'ACTIVE', teacherName: null });
    expect(report.students.map((s: { studentId: string }) => s.studentId)).toEqual([ahmed.id, bilal.id, ziad.id]);
    const row = (id: string) => report.students.find((s: { studentId: string }) => s.studentId === id);
    expect(row(ahmed.id).attendance).toEqual({ present: 1, absent: 1, total: 2 });
    expect(row(ahmed.id).memorization).toEqual({ records: 2, fulfilled: 1, notFulfilled: 1, unscheduled: 0 });
    expect(row(ahmed.id).evaluations.scores.MEMORIZATION).toEqual({ count: 1, average: 8 });
    expect(row(ahmed.id).exams).toEqual({ examined: 1, absent: 0, total: 1 });
    expect(row(bilal.id).exams).toEqual({ examined: 0, absent: 1, total: 1 });
    expect(row(ziad.id).attendance).toEqual({ present: 0, absent: 0, total: 0 });
    expect(report.totals.students).toBe(3);
    expect(report.totals.attendance).toEqual({ present: 1, absent: 1, total: 2 });
    expect(report.totals.exams).toEqual({ examined: 1, absent: 1, total: 2 });
    expect(report.teacherAttendance).toEqual({ present: 1, absent: 1, total: 2 });
    expect(/subscription|payment|status":"ARCHIVED/i.test(JSON.stringify(report.students))).toBe(false);
    expect(all.body.meta).toEqual({ page: 1, pageSize: 20, total: 3, totalPages: 1 }); // standard pagination of the STUDENTS

    // ---- only the students are paginated; the totals always cover everyone
    const first = api.conforms(await request(app).get(url('', `period=ACROSS_TIME&groupId=${group.id}&pageSize=2`)).set(authA));
    expect(first.body.data.students).toHaveLength(2);
    expect(first.body.data.totals.students).toBe(3);
    expect(first.body.meta).toEqual({ page: 1, pageSize: 2, total: 3, totalPages: 2 });
    expect(api.conforms(await request(app).get(url('', `period=ACROSS_TIME&groupId=${group.id}&pageSize=500`)).set(authA)).body.meta.pageSize).toBe(100);
    for (const bad of ['page=0', 'page=abc', 'pageSize=0', 'pageSize=-1']) {
      const refused = api.conforms(await request(app).get(url('', `period=ACROSS_TIME&groupId=${group.id}&${bad}`)).set(authA));
      expect(refused.status, bad).toBe(400);
      expect(JSON.stringify(refused.body), bad).toContain(bad.startsWith('page=') ? 'INVALID_PAGE' : 'INVALID_PAGE_SIZE');
    }

    // ---- the roster follows the period: students who were in the group during it (October), not only today's members
    const october = api.conforms(await request(app).get(url('', `period=CUSTOM&startDate=2026-10-01&endDate=2026-10-31&groupId=${group.id}`)).set(authA)).body.data;
    expect(october.students.map((s: { studentId: string }) => s.studentId)).toEqual([ahmed.id, bilal.id, ziad.id]);
    expect(api.conforms(await request(app).get(url('', `period=ACROSS_TIME&groupId=${group.id}`)).set(authOrg)).body.data.teacherAttendance).toBeDefined();

    // ---- JSON: errors (a group outside the scope and one that does not exist are the SAME 403)
    api.conforms(await request(app).get(url('', `period=ACROSS_TIME`)).set(authA)); // 400 groupId missing
    api.conforms(await request(app).get(url('', `groupId=${group.id}`)).set(authA)); // 400 period missing
    api.conforms(await request(app).get(url('', `period=FOREVER&groupId=${group.id}`)).set(authA)); // 400 INVALID_REPORT_PERIOD
    api.conforms(await request(app).get(url('', `period=ACROSS_TIME&groupId=not-a-uuid`)).set(authA)); // 400
    for (const groupId of [group.id, '3f1b2c4d-5e6a-4b7c-8d9e-0a1b2c3d4e5f']) {
      const outside = api.conforms(await request(app).get(url('', `period=ACROSS_TIME&groupId=${groupId}`)).set(authB));
      expect(outside.status).toBe(403);
      expect(outside.body.error.code).toBe('REPORT_SCOPE_FORBIDDEN');
    }
    for (const auth of [authC, authParent]) {
      const denied = api.conforms(await request(app).get(url('', `period=ACROSS_TIME&groupId=${group.id}`)).set(auth)); // a Collector and a Parent have no group report
      expect(denied.status).toBe(403);
      expect(denied.body.error.code).toBe('REPORT_NOT_ALLOWED');
    }
    api.conforms(await request(app).get(url('', `period=ACROSS_TIME&groupId=${group.id}`))); // 401

    // ---- CSV: a Group section first, then every student of the complete roster
    const csv = api.conforms(await request(app).get(url('/csv', `period=ACROSS_TIME&groupId=${group.id}`)).set(authA));
    expect(csv.status).toBe(200);
    expect(csv.headers['content-disposition']).toContain('group-report-across-time.csv');
    expect(csv.text).toContain('اسم الحلقة');
    for (const name of ['أحمد أحمد محمد', 'بلال أحمد محمد', 'زياد أحمد محمد']) expect(csv.text).toContain(name);
    expect(csv.text).toContain('حضور المعلم');
    expect(csv.text).not.toContain('الاشتراكات');
    api.conforms(await request(app).get(url('/csv', `period=ACROSS_TIME&groupId=${group.id}`)).set(authB)); // 403
    api.conforms(await request(app).get(url('/csv', `period=ACROSS_TIME`)).set(authA)); // 400
    api.conforms(await request(app).get(url('/csv', `period=ACROSS_TIME&groupId=${group.id}`))); // 401

    // ---- Excel: one worksheet per section
    const xlsx = api.conforms(await request(app).get(url('/xlsx', `period=THIS_MONTH&groupId=${group.id}`)).set(authA));
    expect(xlsx.status).toBe(200);
    expect(xlsx.headers['content-type']).toContain('spreadsheetml');
    expect(xlsx.headers['content-disposition']).toContain('group-report-this-month.xlsx');
    api.conforms(await request(app).get(url('/xlsx', `period=ACROSS_TIME&groupId=${group.id}`)).set(authB)); // 403
    api.conforms(await request(app).get(url('/xlsx', `period=FOREVER&groupId=${group.id}`)).set(authA)); // 400
    api.conforms(await request(app).get(url('/xlsx', `period=ACROSS_TIME&groupId=${group.id}`))); // 401
  });

  it('teacher report: multi-school isolation, JSON, CSV and Excel, with their error responses', async () => {
    const { app, t, login, firstLoginAndChange, recordAttendance } = await createReportsApi();
    const schoolA = await t.newSchool('مدرسة النور');
    const schoolB = await t.newSchool('مدرسة الهدى');
    const schoolC = await t.newSchool('مدرسة الأمل');
    const schoolD = await t.newSchool('مدرسة د');
    const otherOrg = await t.otherOrg();
    const schoolX = await t.newSchool('مدرسة أخرى', otherOrg.id); // ANOTHER organization
    const [managerA, managerB, managerC, managerD, managerX] = await Promise.all([schoolA, schoolB, schoolC, schoolD, schoolX].map((school) => t.newSchoolManager(school.id)));
    const orgAdmin2 = await t.newOrgAdmin(otherOrg.id);
    // The Teacher works in schools A and B (linked); school C is history only (never linked now); school X belongs to another organization (history seeded).
    const teacherPhone = '01005550001';
    const teacher = (await t.teachers.registerTeacher({ schoolId: schoolA.id, name: 'محمود حسن علي', phone: teacherPhone }, managerA.id)).teacher;
    await t.teachers.registerTeacher({ schoolId: schoolB.id, name: 'محمود حسن علي', phone: teacherPhone }, managerB.id);
    const groupA = await t.newGroup(schoolA.id, managerA.id, 'حلقة أ');
    const groupB = await t.newGroup(schoolB.id, managerB.id, 'حلقة ب');
    const groupC = await t.newGroup(schoolC.id, managerC.id, 'حلقة ج');
    const groupX = await t.newGroup(schoolX.id, managerX.id, 'حلقة س');
    // The authoritative teaching history, seeded with real dates (the group service's own clock is not movable here).
    let n = 0;
    const history = (groupId: string, action: 'CREATED' | 'TEACHER_CHANGED', iso: string, newTeacherId: string | null) =>
      t.groupRepo.history.push({ id: `00000000-0000-4000-9000-${String(++n).padStart(12, '0')}`, groupId, action, actorId: managerA.id, occurredAt: new Date(iso), reason: null, previousName: null, newName: null, previousTeacherId: null, newTeacherId } as never);
    const seeded = new Set([groupA.id, groupB.id, groupC.id, groupX.id]);
    t.groupRepo.history.splice(0, t.groupRepo.history.length, ...t.groupRepo.history.filter((h) => !seeded.has(h.groupId)));
    history(groupA.id, 'CREATED', '2026-09-10T08:00:00Z', teacher.id); // still teaching
    history(groupB.id, 'CREATED', '2026-09-10T08:00:00Z', null);
    history(groupB.id, 'TEACHER_CHANGED', '2026-10-01T08:00:00Z', teacher.id); // took over in October
    history(groupC.id, 'CREATED', '2026-09-10T08:00:00Z', teacher.id);
    history(groupC.id, 'TEACHER_CHANGED', '2026-10-20T08:00:00Z', null); // left school C on 20 October
    history(groupX.id, 'CREATED', '2026-09-10T08:00:00Z', teacher.id);
    // One student per school, in that school's group, and the records of the period.
    const enrol = async (school: { id: string; organizationId: string }, manager: { id: string }, group: { id: string }) => {
      const parent = await t.newParent(school.id, manager.id);
      const student = await t.registerStudent(school.id, parent.id, manager.id, { joinDate: '2026-09-01', fullName: 'عمر أحمد محمد' });
      t.groupRepo.assignments.push({
        id: `00000000-0000-4000-8000-${String(t.groupRepo.assignments.length + 1).padStart(12, '0')}`, groupId: group.id, studentId: student.id, schoolId: school.id, organizationId: school.organizationId,
        assignedAt: new Date('2026-09-10T08:00:00Z'), assignedBy: manager.id, unassignedAt: null, unassignedBy: null, endReason: null,
      });
      return student;
    };
    const studentA = await enrol(schoolA, managerA, groupA);
    const studentB = await enrol(schoolB, managerB, groupB);
    const studentC = await enrol(schoolC, managerC, groupC);
    const mark = (school: { id: string }, group: { id: string }, subjectType: 'STUDENT' | 'TEACHER', subjectId: string, status: 'PRESENT' | 'ABSENT', date: string) => recordAttendance({ schoolId: school.id, groupId: group.id, subjectType, subjectId, status, date });
    mark(schoolA, groupA, 'STUDENT', studentA.id, 'PRESENT', '2026-10-05');
    mark(schoolA, groupA, 'STUDENT', studentA.id, 'ABSENT', '2026-10-06');
    mark(schoolA, groupA, 'TEACHER', teacher.id, 'PRESENT', '2026-10-05');
    mark(schoolA, groupA, 'TEACHER', teacher.id, 'PRESENT', '2026-10-06');
    mark(schoolA, groupA, 'TEACHER', teacher.id, 'ABSENT', '2026-10-07');
    mark(schoolB, groupB, 'STUDENT', studentB.id, 'PRESENT', '2026-10-07');
    mark(schoolB, groupB, 'TEACHER', teacher.id, 'PRESENT', '2026-10-07');
    mark(schoolC, groupC, 'STUDENT', studentC.id, 'PRESENT', '2026-09-20');
    mark(schoolC, groupC, 'TEACHER', teacher.id, 'PRESENT', '2026-09-20');
    t.setNow('2026-11-18T10:00:00Z');
    const authA = await login(managerA);
    const authB = await login(managerB);
    const authC = await login(managerC);
    const authD = await login(managerD);
    const authOrg = await login(t.orgAdmin);
    const authOrg2 = await login(orgAdmin2);
    const { auth: authTeacher } = await firstLoginAndChange({ phone: teacherPhone, password: teacherPhone.slice(-4) });
    const url = (suffix: string, query: string) => `${REPORTS}/teacher${suffix}?${query}`;
    const get = async (suffix: string, query: string, auth?: Record<string, string>) => {
      const req = request(app).get(url(suffix, query));
      return api.conforms(auth ? await req.set(auth) : await req);
    };
    const others = ['مدرسة الهدى', 'مدرسة الأمل', 'مدرسة أخرى', 'حلقة ب', 'حلقة ج', 'حلقة س', groupB.id, groupC.id, groupX.id, schoolB.id, schoolC.id, schoolX.id];

    // ---- a School Manager sees ONLY their school, whatever else the Teacher does elsewhere
    const a = await get('', `period=ACROSS_TIME&teacherId=${teacher.id}`, authA);
    expect(a.status).toBe(200);
    expect(a.body.data.type).toBe('TEACHER');
    expect(a.body.data.teacher).toEqual({ id: teacher.id, name: 'محمود حسن علي', schools: [{ id: schoolA.id, name: 'مدرسة النور' }] });
    expect(a.body.data.groups).toHaveLength(1);
    expect(a.body.data.groups[0]).toMatchObject({ groupId: groupA.id, groupName: 'حلقة أ', schoolId: schoolA.id, schoolName: 'مدرسة النور', learningMode: 'GROUP', taughtFrom: '2026-09-10', taughtTo: '2026-11-18', stillTeaching: true, teacherAttendance: { present: 2, absent: 1, total: 3 }, students: 1, attendance: { present: 1, absent: 1, total: 2 } });
    expect(others.filter((needle) => JSON.stringify(a.body).includes(needle))).toEqual([]);
    expect(a.body.meta).toEqual({ page: 1, pageSize: 20, total: 1, totalPages: 1 });

    // ---- the same rule, independently, for the managers of B and C (C is history only: the Teacher is no longer linked there)
    const b = await get('', `period=ACROSS_TIME&teacherId=${teacher.id}`, authB);
    expect(b.body.data.teacher.schools).toEqual([{ id: schoolB.id, name: 'مدرسة الهدى' }]);
    expect(b.body.data.groups.map((g: { groupId: string }) => g.groupId)).toEqual([groupB.id]);
    expect(b.body.data.groups[0]).toMatchObject({ taughtFrom: '2026-10-01', teacherAttendance: { present: 1, absent: 0, total: 1 } });
    expect(['مدرسة النور', 'مدرسة الأمل', 'مدرسة أخرى', 'حلقة أ', 'حلقة ج', groupA.id, groupC.id, groupX.id].filter((needle) => JSON.stringify(b.body).includes(needle))).toEqual([]);
    const c = await get('', `period=ACROSS_TIME&teacherId=${teacher.id}`, authC);
    expect(c.status).toBe(200);
    expect(c.body.data.teacher.schools).toEqual([]);
    expect(c.body.data.groups[0]).toMatchObject({ groupId: groupC.id, taughtFrom: '2026-09-10', taughtTo: '2026-10-20', stillTeaching: false, teacherAttendance: { present: 1, absent: 0, total: 1 } });
    expect(['مدرسة النور', 'مدرسة الهدى', 'مدرسة أخرى', groupA.id, groupB.id, groupX.id].filter((needle) => JSON.stringify(c.body).includes(needle))).toEqual([]);

    // ---- an Organization Manager sees every school of their organization the Teacher worked in; the other organization stays out
    const org = await get('', `period=ACROSS_TIME&teacherId=${teacher.id}`, authOrg);
    expect(org.body.data.groups.map((g: { schoolName: string; groupId: string }) => [g.schoolName, g.groupId])).toEqual([['مدرسة الأمل', groupC.id], ['مدرسة النور', groupA.id], ['مدرسة الهدى', groupB.id]]);
    expect(org.body.data.teacher.schools.map((x: { id: string }) => x.id).sort()).toEqual([schoolA.id, schoolB.id].sort());
    expect(['مدرسة أخرى', 'حلقة س', groupX.id, schoolX.id].filter((needle) => JSON.stringify(org.body).includes(needle))).toEqual([]);
    expect(org.body.meta).toEqual({ page: 1, pageSize: 20, total: 3, totalPages: 1 });
    const org2 = await get('', `period=ACROSS_TIME&teacherId=${teacher.id}`, authOrg2);
    expect(org2.body.data.groups.map((g: { groupId: string }) => g.groupId)).toEqual([groupX.id]);
    expect(org2.body.data.teacher.schools).toEqual([]);
    expect(['مدرسة النور', 'مدرسة الهدى', 'مدرسة الأمل', 'حلقة أ', 'حلقة ب', 'حلقة ج', groupA.id, groupB.id, groupC.id].filter((needle) => JSON.stringify(org2.body).includes(needle))).toEqual([]);

    // ---- pagination counts and pages only the authorized entries, and the files hold the same ones
    const page1 = await get('', `period=ACROSS_TIME&teacherId=${teacher.id}&pageSize=2`, authOrg);
    expect(page1.body.data.groups).toHaveLength(2);
    expect(page1.body.meta).toEqual({ page: 1, pageSize: 2, total: 3, totalPages: 2 });
    expect((await get('', `period=ACROSS_TIME&teacherId=${teacher.id}&pageSize=2&page=2`, authOrg)).body.data.groups).toHaveLength(1);
    expect((await get('', `period=ACROSS_TIME&teacherId=${teacher.id}&pageSize=1`, authA)).body.meta).toEqual({ page: 1, pageSize: 1, total: 1, totalPages: 1 });
    expect((await get('', `period=ACROSS_TIME&teacherId=${teacher.id}&pageSize=500`, authOrg)).body.meta.pageSize).toBe(100);
    for (const bad of ['page=0', 'page=abc', 'pageSize=0', 'pageSize=-1']) {
      const refused = await get('', `period=ACROSS_TIME&teacherId=${teacher.id}&${bad}`, authA);
      expect(refused.status, bad).toBe(400);
      expect(JSON.stringify(refused.body), bad).toContain(bad.startsWith('page=') ? 'INVALID_PAGE' : 'INVALID_PAGE_SIZE');
    }
    const october = await get('', `period=LAST_MONTH&teacherId=${teacher.id}`, authOrg);
    expect(october.body.data.groups.map((g: { groupId: string; taughtFrom: string; taughtTo: string }) => [g.groupId, g.taughtFrom, g.taughtTo])).toEqual([[groupC.id, '2026-10-01', '2026-10-20'], [groupA.id, '2026-10-01', '2026-10-31'], [groupB.id, '2026-10-01', '2026-10-31']]);

    // ---- errors: a teacher outside the authorized schools and one that does not exist are the SAME 403; a Teacher (even for themselves) and others have no teacher report
    for (const teacherId of [teacher.id, '3f1b2c4d-5e6a-4b7c-8d9e-0a1b2c3d4e5f']) {
      const outside = await get('', `period=ACROSS_TIME&teacherId=${teacherId}`, authD);
      expect(outside.status).toBe(403);
      expect(outside.body.error.code).toBe('REPORT_SCOPE_FORBIDDEN');
    }
    expect((await get('', `period=ACROSS_TIME&teacherId=3f1b2c4d-5e6a-4b7c-8d9e-0a1b2c3d4e5f`, authOrg)).body.error.code).toBe('REPORT_SCOPE_FORBIDDEN');
    const own = await get('', `period=ACROSS_TIME&teacherId=${teacher.id}`, authTeacher);
    expect(own.status).toBe(403);
    expect(own.body.error.code).toBe('REPORT_NOT_ALLOWED');
    await get('', `period=ACROSS_TIME`, authA); // 400 teacherId missing
    await get('', `teacherId=${teacher.id}`, authA); // 400 period missing
    await get('', `period=FOREVER&teacherId=${teacher.id}`, authA); // 400 INVALID_REPORT_PERIOD
    await get('', `period=ACROSS_TIME&teacherId=not-a-uuid`, authA); // 400
    await get('', `period=ACROSS_TIME&teacherId=${teacher.id}`); // 401

    // ---- CSV: a Teacher section first, only the authorized schools, the school in the item column
    const csvA = await get('/csv', `period=ACROSS_TIME&teacherId=${teacher.id}`, authA);
    expect(csvA.status).toBe(200);
    expect(csvA.headers['content-disposition']).toContain('teacher-report-across-time.csv');
    expect(csvA.text).toContain('اسم المعلم');
    expect(csvA.text).toContain('مدرسة النور (2026-09-10 → 2026-11-18)');
    expect(others.filter((needle) => csvA.text.includes(needle))).toEqual([]);
    const csvOrg = await get('/csv', `period=ACROSS_TIME&teacherId=${teacher.id}`, authOrg);
    for (const needle of ['مدرسة النور', 'مدرسة الهدى', 'مدرسة الأمل']) expect(csvOrg.text).toContain(needle);
    expect(['مدرسة أخرى', 'حلقة س'].filter((needle) => csvOrg.text.includes(needle))).toEqual([]);
    await get('/csv', `period=ACROSS_TIME&teacherId=${teacher.id}`, authD); // 403
    await get('/csv', `period=ACROSS_TIME`, authA); // 400
    await get('/csv', `period=ACROSS_TIME&teacherId=${teacher.id}`); // 401

    // ---- Excel: same authorization and scope as the JSON
    const xlsx = await get('/xlsx', `period=THIS_MONTH&teacherId=${teacher.id}`, authA);
    expect(xlsx.status).toBe(200);
    expect(xlsx.headers['content-type']).toContain('spreadsheetml');
    expect(xlsx.headers['content-disposition']).toContain('teacher-report-this-month.xlsx');
    expect((await get('/xlsx', `period=ACROSS_TIME&teacherId=${teacher.id}`, authD)).status).toBe(403);
    expect((await get('/xlsx', `period=ACROSS_TIME&teacherId=${teacher.id}`, authTeacher)).status).toBe(403);
    await get('/xlsx', `period=FOREVER&teacherId=${teacher.id}`, authA); // 400
    await get('/xlsx', `period=ACROSS_TIME&teacherId=${teacher.id}`); // 401
  });

  it('exercised every documented operation of Module 38', () => {
    expect(api.operationCount('38')).toBe(27);
    api.assertAllExercised('38');
  });
});
