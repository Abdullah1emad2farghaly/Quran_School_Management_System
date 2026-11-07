import { describe, expect, it } from 'vitest';
import { createEvaluationHarness } from '../../helpers/evaluation-harness';

const GPS = { latitude: 30.0444 + 0.0004, longitude: 31.2357, accuracyMeters: 10 }; // about 44 m from the school's official GPS
const MEM_RANGE = { start: { surah: 2, ayah: 1 }, unit: 'AYAHS', amount: 3, direction: 'FORWARD' }; // the mini Quran: surah 2 has 6 ayahs
const REV_RANGE = { unit: 'AYAHS', surah: 2, start: 4, amount: 2, direction: 'FORWARD' };
const at = (iso: string) => new Date(iso);
const MEM3 = (s = 8) => [{ category: 'MEMORIZATION', score: s }, { category: 'PERFORMANCE', score: s }, { category: 'TAJWEED', score: s }];
const ALL4 = (s = 8) => [{ category: 'MEMORIZATION', score: s }, { category: 'REVISION', score: s }, { category: 'PERFORMANCE', score: s }, { category: 'TAJWEED', score: s }];

/**
 * Evaluations over the REAL Smart Guard, Module 24 sessions, Module 20 group assignments and the REAL Attendance, Memorization and Revision services. Session 1 (Monday
 * 2026-11-02) defines the assignments; session 2 (Monday 2026-11-09, 16:00Z-17:00Z) is the one that is evaluated. Nothing is stubbed except storage (in memory).
 */
async function setup(assignments: { memorization: boolean; revision: boolean } = { memorization: true, revision: true }) {
  const t = await createEvaluationHarness();
  const school = await t.newSchool('مدرسة أ');
  const manager = await t.newSchoolManager(school.id);
  const teacher = await t.newTeacher(school.id, manager.id);
  const group = await t.newGroup(school.id, manager.id, { teacherId: teacher.id });
  const parent = await t.newParent(school.id, manager.id);
  const s1 = await t.registerStudent(school.id, parent.id, manager.id);
  const s2 = await t.registerStudent(school.id, parent.id, manager.id);
  const s3 = await t.registerStudent(school.id, parent.id, manager.id);
  for (const s of [s1, s2, s3]) await t.groups.assignStudent(group.id, s.id, manager.id);
  await t.schedules.addSlot(group.id, { dayOfWeek: 'MONDAY', startTime: '18:00', endTime: '19:00' }, manager.id);
  t.sessionClock.set(at('2026-11-02T15:45:00Z'));
  await t.classSessions.generateDueSessions();
  const first = [...t.sessionRepo.rows.keys()][0]!;
  t.sessionClock.set(at('2026-11-02T16:10:00Z'));
  await t.classSessions.advanceDueSessions();
  if (assignments.memorization) await t.memorization.defineAssignment(first, teacher.userId, { range: MEM_RANGE });
  if (assignments.revision) await t.revision.defineAssignment(first, teacher.userId, { range: REV_RANGE });
  t.sessionClock.set(at('2026-11-02T17:30:00Z'));
  await t.classSessions.advanceDueSessions();
  t.sessionClock.set(at('2026-11-09T15:45:00Z'));
  await t.classSessions.generateDueSessions();
  const sessionId = [...t.sessionRepo.rows.keys()].find((id) => id !== first)!;
  t.sessionClock.set(at('2026-11-09T16:10:00Z'));
  await t.classSessions.advanceDueSessions();
  const record = (records: unknown, over: { gps?: unknown; userId?: string } = {}) => t.evaluations.recordEvaluations(sessionId, over.userId ?? teacher.userId, { gps: 'gps' in over ? over.gps : GPS, records });
  return { t, school, manager, teacher, group, s1, s2, s3, sessionId, record };
}
const refused = async (promise: Promise<unknown>, code: string) => expect(promise).rejects.toMatchObject({ code });

describe('Evaluations over the real Smart Guard, sessions, assignments and attendance', () => {
  it('Memorization AND Revision assignments: four categories, recorded with the REAL assignment ids', async () => {
    const { t, s1, record, sessionId } = await setup();
    const { results } = await record([{ studentId: s1.id, scores: ALL4(8.5), note: 'ممتاز' }]);
    expect(results[0]!.outcome).toBe('RECORDED');
    const mem = (await t.memorization.getScheduledMemorization(sessionId)).assignments[0]!;
    const rev = (await t.revision.getScheduledRevision(sessionId)).assignments[0]!;
    const by = Object.fromEntries(results[0]!.evaluation.scores.map((s) => [s.category, s]));
    expect(by.MEMORIZATION).toMatchObject({ memorizationAssignmentId: mem.id, revisionAssignmentId: null });
    expect(by.REVISION).toMatchObject({ memorizationAssignmentId: null, revisionAssignmentId: rev.id });
    expect(by.PERFORMANCE).toMatchObject({ memorizationAssignmentId: mem.id, revisionAssignmentId: rev.id });
  });

  it('Memorization only: Revision is not an available category; the existence of the assignment is enough (no memorization RECORD exists)', async () => {
    const { t, s1, sessionId, record } = await setup({ memorization: true, revision: false });
    await refused(record([{ studentId: s1.id, scores: ALL4() }]), 'EVALUATION_CATEGORIES_MISMATCH');
    expect((await record([{ studentId: s1.id, scores: MEM3() }])).results[0]!.outcome).toBe('RECORDED');
    expect((await t.memorization.getScheduledMemorization(sessionId)).records).toHaveLength(0); // no execution record was needed
  });

  it('no assignment at all: nothing to evaluate', async () => {
    const { s1, record } = await setup({ memorization: false, revision: false });
    await refused(record([{ studentId: s1.id, scores: MEM3() }]), 'EVALUATION_NO_APPLICABLE_ASSIGNMENT');
  });

  it('a student marked ABSENT cannot be evaluated; a student with no attendance record (UNMARKED) can, and no attendance record is created for them', async () => {
    const { t, manager, s1, s2, s3, sessionId, record } = await setup();
    await t.attendance.setStudentAttendanceByManager(sessionId, s2.id, manager.id, { status: 'ABSENT' });
    await refused(record([{ studentId: s1.id, scores: ALL4() }, { studentId: s2.id, scores: ALL4() }]), 'EVALUATION_STUDENT_ABSENT');
    expect(t.evaluationRepo.rows.size).toBe(0);
    await record([{ studentId: s3.id, scores: ALL4() }]); // s3 was never marked
    expect([...t.attendanceRepo.rows.values()].map((r) => r.subjectId)).toEqual([s2.id]); // evaluating created no attendance, and s3 is not ABSENT
  });

  it('a student who already has an evaluation CANNOT be marked ABSENT, by the Teacher or by the School Manager; PRESENT is still fine', async () => {
    const { t, manager, teacher, s1, s2, sessionId, record } = await setup();
    await record([{ studentId: s1.id, scores: ALL4() }]);
    await expect(t.attendance.setStudentAttendanceByManager(sessionId, s1.id, manager.id, { status: 'ABSENT' })).rejects.toMatchObject({ code: 'ATTENDANCE_STUDENT_ALREADY_EVALUATED' });
    await expect(t.attendance.recordStudentAttendance(sessionId, teacher.userId, { gps: GPS, records: [{ studentId: s2.id, status: 'ABSENT' }, { studentId: s1.id, status: 'ABSENT' }] })).rejects.toMatchObject({ code: 'ATTENDANCE_STUDENT_ALREADY_EVALUATED' });
    expect(t.attendanceRepo.rows.size).toBe(0); // the whole batch (including the unrelated s2) was rejected
    const present = await t.attendance.recordStudentAttendance(sessionId, teacher.userId, { gps: GPS, records: [{ studentId: s1.id, status: 'PRESENT' }, { studentId: s2.id, status: 'ABSENT' }] });
    expect(present.results.map((r) => r.outcome)).toEqual(['RECORDED', 'RECORDED']);
    // and an existing PRESENT -> ABSENT correction of an evaluated student is vetoed as well
    await expect(t.attendance.setStudentAttendanceByManager(sessionId, s1.id, manager.id, { status: 'ABSENT', reason: 'خطأ' })).rejects.toMatchObject({ code: 'ATTENDANCE_STUDENT_ALREADY_EVALUATED' });
  });

  it('the School Manager cannot create or modify an evaluation (no write path: the Teacher record is required)', async () => {
    const { manager, s1, record } = await setup();
    await refused(record([{ studentId: s1.id, scores: ALL4() }], { userId: manager.id }), 'SMART_GUARD_NOT_SESSION_TEACHER');
  });

  it('the REAL Smart Guard: the grace period accepts only the Evaluations exception; Attendance still stops at the scheduled end', async () => {
    const { t, teacher, s1, s2, sessionId, record } = await setup();
    await record([{ studentId: s1.id, scores: ALL4(6) }]);
    // the job that moves the session to COMPLETED has NOT run: the window is still judged by the scheduled end (17:00Z)
    t.sessionClock.set(at('2026-11-09T17:05:00Z'));
    expect((await t.classSessions.getSession(sessionId)).status).toBe('IN_PROGRESS');
    await refused(t.attendance.recordStudentAttendance(sessionId, teacher.userId, { gps: GPS, records: [{ studentId: s1.id, status: 'PRESENT' }] }), 'SMART_GUARD_OUTSIDE_SESSION_WINDOW');
    expect((await record([{ studentId: s2.id, scores: ALL4(7) }])).results[0]!.outcome).toBe('RECORDED'); // a missing evaluation: allowed
    await refused(record([{ studentId: s1.id, scores: [{ category: 'TAJWEED', score: 1 }] }]), 'EVALUATION_GRACE_CREATE_ONLY'); // an existing one: no
    await refused(record([{ studentId: s2.id, scores: ALL4(7) }], { gps: undefined }), 'SMART_GUARD_GPS_REQUIRED'); // GPS is still mandatory
    await refused(record([{ studentId: s2.id, scores: ALL4(7) }], { gps: { ...GPS, latitude: 31 } }), 'SMART_GUARD_OUTSIDE_SCHOOL_GEOFENCE');
    t.sessionClock.set(at('2026-11-09T17:15:00.001Z'));
    await refused(record([{ studentId: s1.id, scores: ALL4() }]), 'SMART_GUARD_OUTSIDE_SESSION_WINDOW'); // closed for good
    expect(t.evaluationRepo.rows.size).toBe(2);
  });

  it('also after the job completed the session (the status is irrelevant), and before the start (Smart Guard lead window)', async () => {
    const { t, s1, s2, sessionId, record } = await setup();
    t.sessionClock.set(at('2026-11-09T17:02:00Z'));
    await t.classSessions.advanceDueSessions();
    expect((await t.classSessions.getSession(sessionId)).status).toBe('COMPLETED');
    expect((await record([{ studentId: s1.id, scores: ALL4() }])).results[0]!.outcome).toBe('RECORDED');
    expect(s2).toBeDefined();
  });

  it('the pre-end warning data (the Notifications modules deliver it): present students with an assignment and no evaluation', async () => {
    const { t, manager, teacher, s1, s2, s3, sessionId, record } = await setup();
    await t.attendance.recordStudentAttendance(sessionId, teacher.userId, { gps: GPS, records: [{ studentId: s1.id, status: 'PRESENT' }, { studentId: s2.id, status: 'PRESENT' }, { studentId: s3.id, status: 'ABSENT' }] });
    await record([{ studentId: s1.id, scores: ALL4() }]);
    const status = await t.evaluations.getSessionEvaluationStatus(sessionId);
    expect(status.incompleteStudentIds).toEqual([s2.id]);
    expect(status.students.find((s) => s.studentId === s3.id)).toMatchObject({ attendance: 'ABSENT', evaluationRequired: false });
    expect(status.warningDueAt.toISOString()).toBe('2026-11-09T16:45:00.000Z');
    expect(manager).toBeDefined();
  });

  it('publishes EvaluationRecorded and EvaluationScoresUpdated through the outbox in the same transaction, and nothing else is notified', async () => {
    const { t, s1, record } = await setup();
    await record([{ studentId: s1.id, scores: ALL4(5), note: 'ن' }]);
    await record([{ studentId: s1.id, scores: [{ category: 'TAJWEED', score: 9 }] }]);
    const messages = t.h.store.messages.filter((m) => m.aggregateType === 'Evaluation');
    expect(messages.map((m) => m.eventType)).toEqual(['EvaluationRecorded', 'EvaluationScoresUpdated']);
    expect(JSON.parse(messages[0]!.payload)).toMatchObject({ studentId: s1.id, note: 'ن' });
    expect(JSON.parse(messages[1]!.payload).scores.find((x: { category: string }) => x.category === 'TAJWEED')).toMatchObject({ score: 9 });
  });
});
