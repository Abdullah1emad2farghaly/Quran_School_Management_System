import { describe, expect, it } from 'vitest';
import { createPaymentsHarness } from '../../helpers/payments-harness';

/** The read-only aggregates Module 38 needs from Modules 16, 33 and 34 (additive: no existing behaviour changes). */
describe('report read contracts of Modules 16, 33 and 34', () => {
  async function fixture() {
    const t = await createPaymentsHarness();
    const schoolA = await t.newSchool('مدرسة أ');
    const schoolB = await t.newSchool('مدرسة ب');
    const managerA = await t.newSchoolManager(schoolA.id);
    const managerB = await t.newSchoolManager(schoolB.id);
    const students = [await t.newStudent(schoolA.id, managerA.id), await t.newStudent(schoolA.id, managerA.id)];
    await t.newStudent(schoolB.id, managerB.id);
    t.setNow('2026-10-10T09:00:00Z');
    await t.subscriptions.createMonthlySubscriptions(schoolA.id, managerA.id);
    await t.subscriptions.createMonthlySubscriptions(schoolB.id, managerB.id);
    const sub = async (i: number, month: string) => (await t.subscriptionRepo.findByStudentMonth(students[i]!.id, month))!.snapshot.id;
    const first = await t.payments.recordPayment(await sub(0, '2026-10'), managerA.id);
    await t.subscriptions.waiveSubscription(await sub(1, '2026-10'), managerA.id);
    t.setNow('2026-11-10T09:00:00Z');
    await t.subscriptions.createMonthlySubscriptions(schoolA.id, managerA.id);
    return { t, schoolA, schoolB, managerA, first };
  }

  it('subscription counts per school, month and status, bounded by months, only for the asked schools', async () => {
    const { t, schoolA, schoolB } = await fixture();
    const key = (c: { schoolId: string; month: string; status: string; count: number }) => `${c.schoolId === schoolA.id ? 'A' : 'B'}|${c.month}|${c.status}|${c.count}`;
    expect((await t.subscriptions.countStatusesForReport({ schoolIds: [schoolA.id] })).map(key)).toEqual(['A|2026-10|PAID|1', 'A|2026-10|WAIVED|1', 'A|2026-11|UNPAID|2']);
    expect((await t.subscriptions.countStatusesForReport({ schoolIds: [schoolA.id], fromMonth: '2026-11' })).map(key)).toEqual(['A|2026-11|UNPAID|2']);
    expect((await t.subscriptions.countStatusesForReport({ schoolIds: [schoolA.id], toMonth: '2026-10' })).map(key)).toEqual(['A|2026-10|PAID|1', 'A|2026-10|WAIVED|1']);
    expect((await t.subscriptions.countStatusesForReport({ schoolIds: [schoolB.id] })).map(key)).toEqual(['B|2026-10|UNPAID|1']);
    expect(await t.subscriptions.countStatusesForReport({ schoolIds: [] })).toEqual([]);
  });

  it('payment counts per school, month and status: a reversal stays as history', async () => {
    const { t, schoolA, managerA, first } = await fixture();
    expect(await t.payments.countPaymentsForReport({ schoolIds: [schoolA.id] })).toEqual([{ schoolId: schoolA.id, month: '2026-10', status: 'SUCCESSFUL', count: 1 }]);
    await t.payments.reversePayment(first.id, 'خطأ', managerA.id);
    expect(await t.payments.countPaymentsForReport({ schoolIds: [schoolA.id] })).toEqual([{ schoolId: schoolA.id, month: '2026-10', status: 'REVERSED', count: 1 }]);
    expect(await t.payments.countPaymentsForReport({ schoolIds: [schoolA.id], fromMonth: '2026-11' })).toEqual([]);
    expect(await t.payments.countPaymentsForReport({ schoolIds: [] })).toEqual([]);
  });

  it('the school ids of an organization (only its own), and nothing for an unknown or empty organization list', async () => {
    const { t, schoolA, schoolB } = await fixture();
    expect((await t.service.listSchoolIdsOfOrganizations([schoolA.organizationId])).sort()).toEqual([schoolA.id, schoolB.id].sort());
    const other = await t.otherOrg();
    const foreign = await t.newSchool('مدرسة أجنبية', other.id);
    expect(await t.service.listSchoolIdsOfOrganizations([other.id])).toEqual([foreign.id]);
    expect(await t.service.listSchoolIdsOfOrganizations([])).toEqual([]);
    expect(await t.service.listSchoolIdsOfOrganizations(['00000000-0000-4000-8000-000000000000'])).toEqual([]);
  });

  it('student facts (name and join date) and group names for reports: a missing id has no entry', async () => {
    const { t, schoolA, managerA } = await fixture();
    const parent = await t.newParent(schoolA.id, managerA.id);
    const student = await t.registerStudent(schoolA.id, parent.id, managerA.id, { joinDate: '2026-09-01' });
    const group = await t.newGroup(schoolA.id, managerA.id, 'حلقة الفجر');
    const missing = '00000000-0000-4000-8000-000000000000';
    expect(await t.students.listReportFacts([student.id, missing, student.id])).toEqual([{ id: student.id, fullName: student.fullName, joinDate: '2026-09-01' }]);
    expect(await t.students.listReportFacts([])).toEqual([]);
    expect([...(await t.groups.listNamesByIds([group.id, missing])).entries()]).toEqual([[group.id, 'حلقة الفجر']]);
  });
});
