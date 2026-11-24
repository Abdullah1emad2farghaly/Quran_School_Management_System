import { randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { registerAllErrorMessages } from '../../src/app/bootstrap/register-error-messages';
import { errorHandler, notFoundHandler } from '../../src/app/middleware/error-handler.middleware';
import { requestContextMiddleware } from '../../src/app/middleware/request-context.middleware';
import { createAuthRouter, createRequireAuthentication } from '../../src/modules/10-sessions-jwt/public';
import { ReportPeriodService, ReportScopeResolver, type ReportScopeSources } from '../../src/modules/37-reports-core/public';
import { InMemoryMemorizationRepository } from '../../src/modules/27-memorization/public';
import { InMemoryRevisionRepository } from '../../src/modules/28-revision/public';
import { InMemoryEvaluationRepository, type EvaluationCategory } from '../../src/modules/29-evaluations/public';
import { ExamService, InMemoryExamRepository } from '../../src/modules/30-exams/public';
import { InMemoryAttendanceRepository, type ActorRole, type AttendanceStatus, type SubjectType } from '../../src/modules/26-attendance/public';
import { PublicAttendanceReportSources, PublicMemorizationReportSources, PublicEvaluationReportSources, PublicPaymentReportSources, PublicGroupReportSources, PublicParentReportSources, PublicRevisionReportSources, PublicStudentReportSources, PublicTeacherReportSources, ReportService, createReportRouter } from '../../src/modules/38-report-modules/public';
import { createPaymentsHarness } from './payments-harness';

export const REPORTS = '/api/v1/reports';
export const AUTH = '/api/v1/auth';

/**
 * The real Reports and Auth routers over the in-memory Payments harness (real sessions, real Module 37 scope resolver, real Modules 16/33/34 services behind the public contracts).
 * Organization administrators, school managers, collectors and PARENTS are the real ones (a Parent's scope is their real children); the harness has no teachers or area managers, so those scope sources answer nothing
 * (those roles are covered with fake sources in tests/unit/report-modules/report-service.test.ts).
 */
export async function createReportsApi() {
  registerAllErrorMessages();
  const t = await createPaymentsHarness();
  const attendanceRepo = new InMemoryAttendanceRepository();
  const memorizationRepo = new InMemoryMemorizationRepository();
  const revisionRepo = new InMemoryRevisionRepository();
  const evaluationRepo = new InMemoryEvaluationRepository();
  const examRepo = new InMemoryExamRepository();
  const examService = new ExamService({ exams: examRepo } as never); // only the read-only report method is used here
  const sources: ReportScopeSources = {
    organizationIdsOfAdmin: (userId) => t.organizations.listAdministeredOrganizationIds(userId),
    schoolIdsOfManager: (userId) => t.service.listManagedSchoolIds(userId),
    schoolIdsOfCollector: (userId) => t.collectors.listActiveSchoolIds(userId),
    groupIdsOfTeacher: (userId) => t.groups.listCurrentGroupIdsOfTeacherUser(userId),
    studentIdsOfParent: async (userId) => (await t.students.listChildrenOfParentUser(userId, { page: { page: 1, pageSize: 100 } })).items.map((child) => child.id),
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
    memorization: new PublicMemorizationReportSources({
      schools: t.service,
      students: t.students,
      teachers: t.teachers,
      groups: t.groups,
      memorization: { summarizeForReport: (query) => memorizationRepo.summarizeForReport(query) },
    }),
    revision: new PublicRevisionReportSources({
      schools: t.service,
      students: t.students,
      teachers: t.teachers,
      groups: t.groups,
      revision: { summarizeForReport: (query) => revisionRepo.summarizeForReport(query) },
    }),
    evaluation: new PublicEvaluationReportSources({
      schools: t.service,
      students: t.students,
      teachers: t.teachers,
      groups: t.groups,
      evaluation: { summarizeForReport: (query) => evaluationRepo.summarizeForReport(query) },
    }),
    teacher: new PublicTeacherReportSources({ schools: t.service, teachers: t.teachers, groups: t.groups }),
    group: new PublicGroupReportSources({ schools: t.service, students: t.students, groups: t.groups, exams: examService }),
    parent: new PublicParentReportSources({ schools: t.service, parents: t.parents, students: t.students }),
    student: new PublicStudentReportSources({ schools: t.service, students: t.students, teachers: t.teachers, groups: t.groups, exams: examService, subscriptions: t.subscriptions }),
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
  /** Stores one memorization record straight in the in-memory store (the report only reads it; recording is Module 27's own, separately tested, workflow). `matches` is the stored fulfilment state. */
  const recordMemorization = (r: { schoolId: string; groupId: string; studentId: string; matches: boolean | null; sessionStart: string }) => {
    const id = randomUUID();
    const at = new Date(r.sessionStart);
    const who = '00000000-0000-0000-0000-000000000001';
    memorizationRepo.records.set(id, {
      id, sessionId: randomUUID(), schoolId: r.schoolId, groupId: r.groupId, studentId: r.studentId, assignmentId: r.matches === null ? null : randomUUID(),
      range: { request: { start: { surah: 1, ayah: 1 }, unit: 'AYAHS', amount: 7, direction: 'FORWARD' }, first: { surah: 1, ayah: 1 }, last: { surah: 1, ayah: 7 }, segments: [{ surah: 1, firstAyah: 1, lastAyah: 7 }], ayahCount: 7 },
      matchesAssignment: r.matches, recordedBy: who, recordedAt: at, updatedBy: who, updatedAt: at, sessionScheduledStart: at,
    });
  };
  /** Stores one revision record straight in the in-memory store (the report only reads it; recording is Module 28's own, separately tested, workflow). `matches` is the stored fulfilment state. */
  const recordRevision = (r: { schoolId: string; groupId: string; studentId: string; matches: boolean | null; sessionStart: string }) => {
    const id = randomUUID();
    const at = new Date(r.sessionStart);
    const who = '00000000-0000-0000-0000-000000000001';
    revisionRepo.records.set(id, {
      id, sessionId: randomUUID(), schoolId: r.schoolId, groupId: r.groupId, studentId: r.studentId, assignmentId: r.matches === null ? null : randomUUID(),
      range: { input: { form: 'START_UNIT_AMOUNT', unit: 'AYAHS', surah: 1, start: 1, amount: 7, direction: 'FORWARD' }, request: { start: { surah: 1, ayah: 1 }, unit: 'AYAHS', amount: 7, direction: 'FORWARD' }, first: { surah: 1, ayah: 1 }, last: { surah: 1, ayah: 7 }, segments: [{ surah: 1, firstAyah: 1, lastAyah: 7 }], ayahCount: 7 },
      matchesAssignment: r.matches, recordedBy: who, recordedAt: at, updatedBy: who, updatedAt: at, sessionScheduledStart: at,
    });
  };
  /** Stores one evaluation straight in the in-memory store (the report only reads it; recording is Module 29's own, separately tested, workflow). `recordedBy` is the Teacher's user id. */
  const recordEvaluation = (r: { schoolId: string; groupId: string; studentId: string; recordedBy: string; sessionStart: string; scores: Partial<Record<EvaluationCategory, number>> }) => {
    const id = randomUUID();
    const at = new Date(r.sessionStart);
    evaluationRepo.rows.set(id, {
      id, sessionId: randomUUID(), schoolId: r.schoolId, groupId: r.groupId, studentId: r.studentId, occurrenceDate: r.sessionStart.slice(0, 10), scheduledStart: at, note: null,
      scores: (Object.entries(r.scores) as Array<[EvaluationCategory, number]>).map(([category, score]) => ({ category, score, memorizationAssignmentId: null, revisionAssignmentId: null })),
      recordedBy: r.recordedBy, recordedAt: at, updatedBy: r.recordedBy, updatedAt: at,
    });
  };
  /** Stores one exam outcome straight in the in-memory store (the report only reads it; running exams is Module 30's own, separately tested, workflow). `scores` only for EXAMINED. */
  const recordExam = (r: { schoolId: string; groupId: string; studentId: string; startAt: string; outcome: 'EXAMINED' | 'ABSENT'; scores?: number[]; questionCount?: number; maxScore?: number }) => {
    const id = randomUUID();
    const at = new Date(r.startAt);
    const scores = r.scores ?? [];
    examRepo.exams.set(id, {
      id, schoolId: r.schoolId, wholeSchool: false, groupIds: [r.groupId], startAt: at, endAt: null, questionCount: r.questionCount ?? Math.max(scores.length, 1), maxScore: r.maxScore ?? 10, status: 'ENDED', examiners: [],
      createdBy: '00000000-0000-0000-0000-000000000001', createdAt: at, updatedAt: at, scheduledAt: null, startedAt: at, completedAt: at, endedAt: at, cancelledAt: null, deletedAt: null,
    });
    examRepo.students.push({ examId: id, studentId: r.studentId, groupId: r.groupId, groupName: 'g', fullName: 'n', status: r.outcome });
    if (r.outcome === 'EXAMINED') {
      const resultId = randomUUID();
      examRepo.results.set(resultId, {
        id: resultId, examId: id, schoolId: r.schoolId, groupId: r.groupId, studentId: r.studentId, scores, total: scores.reduce((a, b) => a + b, 0),
        examinerTeacherId: randomUUID(), examinerUserId: randomUUID(), recordedAt: at,
      });
    }
  };
  return { app, t, login, firstLoginAndChange, reports, attendanceRepo, recordAttendance, memorizationRepo, recordMemorization, revisionRepo, recordRevision, evaluationRepo, recordEvaluation, examRepo, recordExam };
}
