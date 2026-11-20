import { randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { registerAllErrorMessages } from '../../src/app/bootstrap/register-error-messages';
import { errorHandler, notFoundHandler } from '../../src/app/middleware/error-handler.middleware';
import { requestContextMiddleware } from '../../src/app/middleware/request-context.middleware';
import { createAuthRouter, createRequireAuthentication } from '../../src/modules/10-sessions-jwt/public';
import { ReportPeriodService, ReportScopeResolver, type ReportScopeSources } from '../../src/modules/37-reports-core/public';
import { InMemoryAttendanceRepository, type ActorRole, type AttendanceStatus, type SubjectType } from '../../src/modules/26-attendance/public';
import { PublicAttendanceReportSources, PublicPaymentReportSources, ReportService, createReportRouter } from '../../src/modules/38-report-modules/public';
import { createPaymentsHarness } from './payments-harness';

export const REPORTS = '/api/v1/reports';
export const AUTH = '/api/v1/auth';

/**
 * The real Reports and Auth routers over the in-memory Payments harness (real sessions, real Module 37 scope resolver, real Modules 16/33/34 services behind the public contracts).
 * Organization administrators, school managers and collectors are the real ones; the harness has no teachers, parents or area managers, so those scope sources answer nothing
 * (those roles are covered with fake sources in tests/unit/report-modules/report-service.test.ts).
 */
export async function createReportsApi() {
  registerAllErrorMessages();
  const t = await createPaymentsHarness();
  const attendanceRepo = new InMemoryAttendanceRepository();
  const sources: ReportScopeSources = {
    organizationIdsOfAdmin: (userId) => t.organizations.listAdministeredOrganizationIds(userId),
    schoolIdsOfManager: (userId) => t.service.listManagedSchoolIds(userId),
    schoolIdsOfCollector: (userId) => t.collectors.listActiveSchoolIds(userId),
    groupIdsOfTeacher: (userId) => t.groups.listCurrentGroupIdsOfTeacherUser(userId),
    studentIdsOfParent: async () => [],
    geographicAreasOfManager: async () => undefined,
  };
  const reports = new ReportService({
    scopes: new ReportScopeResolver(sources),
    periods: new ReportPeriodService({ clock: t.clock }),
    payments: new PublicPaymentReportSources({ schools: t.service, subscriptions: t.subscriptions, payments: t.payments }),
    attendance: new PublicAttendanceReportSources({
      schools: t.service,
      students: t.students,
      teachers: t.teachers,
      groups: t.groups,
      attendance: { summarizeForReport: (query) => attendanceRepo.summarizeForReport(query) },
    }),
    clock: t.clock,
  });
  const requireAuthentication = createRequireAuthentication(() => t.h.service);
  const app = express();
  app.use(requestContextMiddleware);
  app.use(express.json());
  app.use(REPORTS, createReportRouter({ getReports: () => reports, requireAuthentication }));
  app.use(
    AUTH,
    createAuthRouter({
      getService: () => t.h.service,
      requireAuthentication,
      requireAuthenticationAllowingPasswordChange: createRequireAuthentication(() => t.h.service, { allowPasswordChangePending: true }),
    }),
  );
  app.use(notFoundHandler);
  app.use(errorHandler);

  const login = async (u: { phone: string; password: string }) => {
    const res = await request(app).post(`${AUTH}/login`).send({ phone: u.phone, password: u.password });
    if (res.status !== 200) throw new Error(`login failed: ${JSON.stringify(res.body)}`);
    return { Authorization: `Bearer ${res.body.data.accessToken}` };
  };
  /**
   * A Collector's account is created with a mandatory password change (like Parent and Teacher accounts): until it is made, the verified token only reaches change-password and the logouts,
   * and every report is refused with 403 PASSWORD_CHANGE_REQUIRED. Returns the `blocked` response of a report request made BEFORE the change (the change lifts the restriction for
   * the account, so the same token works afterwards) and the header of a new login after the change.
   */
  const firstLoginAndChange = async (u: { phone: string; password: string }) => {
    const first = await request(app).post(`${AUTH}/login`).send({ phone: u.phone, password: u.password });
    if (first.status !== 200) throw new Error(`login failed: ${JSON.stringify(first.body)}`);
    const pending = { Authorization: `Bearer ${first.body.data.accessToken}` };
    const blocked = await request(app).get(`${REPORTS}/payment?period=ACROSS_TIME`).set(pending);
    const changed = await request(app).post(`${AUTH}/change-password`).set(pending).send({ currentPassword: u.password, newPassword: 'new-pass-12' });
    if (changed.status !== 204) throw new Error(`change-password failed: ${JSON.stringify(changed.body)}`);
    return { blocked, auth: await login({ phone: u.phone, password: 'new-pass-12' }) };
  };
  /** Stores one attendance record straight in the in-memory store (the report only reads it; recording is Module 26's own, separately tested, workflow). */
  const recordAttendance = (r: { schoolId: string; groupId: string; subjectType: SubjectType; subjectId: string; status: AttendanceStatus; date: string }) => {
    const id = randomUUID();
    const at = new Date(`${r.date}T09:00:00Z`);
    const who = '00000000-0000-0000-0000-000000000001';
    attendanceRepo.rows.set(id, {
      id, sessionId: randomUUID(), schoolId: r.schoolId, groupId: r.groupId, subjectType: r.subjectType, subjectId: r.subjectId, status: r.status, occurrenceDate: r.date,
      scheduledStart: at, recordedBy: who, recordedByRole: 'SCHOOL_MANAGER' as ActorRole, recordedAt: at, updatedBy: who, updatedByRole: 'SCHOOL_MANAGER' as ActorRole, updatedAt: at,
    });
  };
  return { app, t, login, firstLoginAndChange, reports, attendanceRepo, recordAttendance };
}
