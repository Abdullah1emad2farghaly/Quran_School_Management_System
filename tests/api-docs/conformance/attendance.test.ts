import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { ATTENDANCE, createAttendanceApi } from '../../helpers/attendance-api-harness';
import { ApiConformance } from '../support/conformance';

const UNKNOWN = '00000000-0000-4000-8000-000000000000';
const THRESHOLD = new Date('2026-11-02T15:45:00Z'); // the 18:00 Cairo (UTC+2) slot runs 16:00Z-17:00Z
const IN_WINDOW = new Date('2026-11-02T16:10:00Z');
const GPS = { latitude: 30.0444 + 0.0004, longitude: 31.2357, accuracyMeters: 10 };

describe('Module 26 endpoints conform to their OpenAPI documentation (real responses)', () => {
  let api: ApiConformance;
  beforeAll(async () => {
    api = await ApiConformance.create();
  });

  it('attendance: record, check in, correct, read, with their error responses', async () => {
    const { app, t, login, loginInitial } = await createAttendanceApi();
    const school = await t.newSchool('مدرسة أ');
    const school2 = await t.newSchool('مدرسة ب');
    const manager = await t.newSchoolManager(school.id);
    const manager2 = await t.newSchoolManager(school2.id);
    const mAuth = await login(manager);
    const m2Auth = await login(manager2);
    const teacher = await t.newTeacher(school.id, manager.id);
    const teacher2 = await t.newTeacher(school.id, manager.id);
    const parent = await t.newParent(school.id, manager.id);
    const parent2 = await t.newParent(school.id, manager.id);
    const group = await t.newGroup(school.id, manager.id, { teacherId: teacher.id });
    const s1 = await t.registerStudent(school.id, parent.id, manager.id);
    const s2 = await t.registerStudent(school.id, parent.id, manager.id);
    const outsider = await t.registerStudent(school.id, parent.id, manager.id);
    await t.groups.assignStudent(group.id, s1.id, manager.id);
    await t.groups.assignStudent(group.id, s2.id, manager.id);
    await t.schedules.addSlot(group.id, { dayOfWeek: 'MONDAY', startTime: '18:00', endTime: '19:00' }, manager.id);
    const phoneOf = async (userId: string) => (await t.h.identity.findById(userId))!.phone;
    const tAuth = await loginInitial(await phoneOf(teacher.userId));
    const t2Auth = await loginInitial(await phoneOf(teacher2.userId));
    const pAuth = await loginInitial(await phoneOf(parent.userId));
    const p2Auth = await loginInitial(await phoneOf(parent2.userId));
    t.sessionClock.set(THRESHOLD);
    await t.classSessions.generateDueSessions();
    const sessionId = [...t.sessionRepo.rows.keys()][0]!;
    t.sessionClock.set(IN_WINDOW);
    const students = `${ATTENDANCE}/sessions/${sessionId}/students`;

    // record students (Teacher, Smart Guard)
    api.conforms(await request(app).post(students).set(tAuth).send({ gps: GPS })); // 400 records missing
    const noGps = await request(app).post(students).set(tAuth).send({ records: [{ studentId: s1.id, status: 'PRESENT' }] });
    expect(noGps.body.error.code).toBe('SMART_GUARD_GPS_REQUIRED');
    api.conforms(noGps);
    const far = await request(app).post(students).set(tAuth).send({ gps: { ...GPS, latitude: 30.0444 + 0.00046 }, records: [{ studentId: s1.id, status: 'PRESENT' }] });
    expect(far.status).toBe(422);
    api.conforms(far);
    const notInGroup = await request(app).post(students).set(tAuth).send({ gps: GPS, records: [{ studentId: s1.id, status: 'PRESENT' }, { studentId: outsider.id, status: 'PRESENT' }] });
    expect(notInGroup.body.error.code).toBe('ATTENDANCE_STUDENT_NOT_IN_GROUP');
    api.conforms(notInGroup);
    api.conforms(await request(app).post(students).send({ gps: GPS, records: [] })); // 401
    api.conforms(await request(app).post(students).set(mAuth).send({ gps: GPS, records: [{ studentId: s1.id, status: 'PRESENT' }] })); // 403 manager
    api.conforms(await request(app).post(students).set(pAuth).send({ gps: GPS, records: [{ studentId: s1.id, status: 'PRESENT' }] })); // 403 parent
    api.conforms(await request(app).post(students).set(t2Auth).send({ gps: GPS, records: [{ studentId: s1.id, status: 'PRESENT' }] })); // 403 Teacher of another group
    api.conforms(await request(app).post(`${ATTENDANCE}/sessions/${UNKNOWN}/students`).set(tAuth).send({ gps: GPS, records: [{ studentId: s1.id, status: 'PRESENT' }] })); // 404
    api.conforms(await request(app).post(`${ATTENDANCE}/sessions/not-a-uuid/students`).set(tAuth).send({ gps: GPS, records: [] })); // 400
    const recorded = api.conforms(await request(app).post(students).set(tAuth).send({ gps: GPS, records: [{ studentId: s1.id, status: 'PRESENT' }, { studentId: s2.id, status: 'ABSENT' }] }));
    expect(recorded.status).toBe(200);
    expect(recorded.body.data.results.map((r: { outcome: string }) => r.outcome)).toEqual(['RECORDED', 'RECORDED']);
    const noReason = await request(app).post(students).set(tAuth).send({ gps: GPS, records: [{ studentId: s2.id, status: 'PRESENT' }] });
    expect(noReason.body.error.code).toBe('ATTENDANCE_CORRECTION_REASON_REQUIRED');
    api.conforms(noReason);
    const corrected = api.conforms(await request(app).post(students).set(tAuth).send({ gps: GPS, records: [{ studentId: s2.id, status: 'PRESENT', reason: 'سُجّل خطأً' }] }));
    expect(corrected.body.data.results[0].outcome).toBe('CORRECTED');
    expect((await request(app).post(students).set(tAuth).send({ gps: GPS, records: [{ studentId: s2.id, status: 'PRESENT' }] })).body.data.results[0].outcome).toBe('UNCHANGED');
    expect((await t.attendance.listCorrectionsOfSession(sessionId))).toHaveLength(1);

    // Teacher check-in
    const checkIn = `${ATTENDANCE}/sessions/${sessionId}/teacher/check-in`;
    api.conforms(await request(app).post(checkIn).set(tAuth).send({})); // 400 no GPS
    api.conforms(await request(app).post(checkIn).set(mAuth).send({ gps: GPS })); // 403
    api.conforms(await request(app).post(checkIn).send({ gps: GPS })); // 401
    const checked = api.conforms(await request(app).post(checkIn).set(tAuth).send({ gps: GPS }));
    expect(checked.status).toBe(200);
    expect(checked.body.data.results[0]).toMatchObject({ outcome: 'RECORDED', subjectId: teacher.id });

    // School Manager: the Teacher and a student, no GPS
    const teacherUrl = `${ATTENDANCE}/sessions/${sessionId}/teacher`;
    api.conforms(await request(app).put(teacherUrl).set(mAuth).send({})); // 400 status missing
    api.conforms(await request(app).put(teacherUrl).set(mAuth).send({ status: 'LATE' })); // 400
    api.conforms(await request(app).put(teacherUrl).set(mAuth).send({ status: 'ABSENT', reason: 'a'.repeat(501) })); // 400
    api.conforms(await request(app).put(teacherUrl).set(tAuth).send({ status: 'ABSENT', reason: 'x' })); // 403 a Teacher cannot use the manager endpoint
    api.conforms(await request(app).put(teacherUrl).set(m2Auth).send({ status: 'ABSENT', reason: 'x' })); // 403 another school
    api.conforms(await request(app).put(`${ATTENDANCE}/sessions/${UNKNOWN}/teacher`).set(mAuth).send({ status: 'ABSENT' })); // 404
    const teacherFix = await request(app).put(teacherUrl).set(mAuth).send({ status: 'ABSENT' }); // an existing PRESENT record: a reason is required
    expect(teacherFix.body.error.code).toBe('ATTENDANCE_CORRECTION_REASON_REQUIRED');
    api.conforms(teacherFix);
    const teacherOk = api.conforms(await request(app).put(teacherUrl).set(mAuth).send({ status: 'ABSENT', reason: 'غادر مبكرًا' }));
    expect(teacherOk.body.data.results[0]).toMatchObject({ outcome: 'CORRECTED', record: { status: 'ABSENT', updatedByRole: 'SCHOOL_MANAGER' } });
    const studentUrl = `${ATTENDANCE}/sessions/${sessionId}/students/${s1.id}`;
    api.conforms(await request(app).put(`${ATTENDANCE}/sessions/${sessionId}/students/not-a-uuid`).set(mAuth).send({ status: 'ABSENT' })); // 400
    api.conforms(await request(app).put(`${ATTENDANCE}/sessions/${sessionId}/students/${outsider.id}`).set(mAuth).send({ status: 'ABSENT' })); // 422 not in the group, no record
    api.conforms(await request(app).put(studentUrl).set(pAuth).send({ status: 'ABSENT', reason: 'x' })); // 403
    t.sessionClock.set(new Date('2026-11-09T09:00:00Z')); // days later: a manager needs no time window and no GPS
    const studentOk = api.conforms(await request(app).put(studentUrl).set(mAuth).send({ status: 'ABSENT', reason: 'كان غائبًا' }));
    expect(studentOk.status).toBe(200);
    expect(studentOk.body.data.results[0].outcome).toBe('CORRECTED');
    t.sessionClock.set(IN_WINDOW);

    // reads
    const session = api.conforms(await request(app).get(`${ATTENDANCE}/sessions/${sessionId}`).set(mAuth));
    expect(session.status).toBe(200);
    expect(session.body.data.students).toHaveLength(2);
    expect(session.body.data.teacher).toMatchObject({ status: 'ABSENT' });
    expect(api.conforms(await request(app).get(`${ATTENDANCE}/sessions/${sessionId}`).set(tAuth)).status).toBe(200);
    api.conforms(await request(app).get(`${ATTENDANCE}/sessions/${sessionId}`).set(pAuth)); // 403 a Parent does not read a session
    api.conforms(await request(app).get(`${ATTENDANCE}/sessions/${sessionId}`).set(m2Auth)); // 403
    api.conforms(await request(app).get(`${ATTENDANCE}/sessions/${sessionId}`).set(t2Auth)); // 403
    api.conforms(await request(app).get(`${ATTENDANCE}/sessions/${UNKNOWN}`).set(mAuth)); // 404
    api.conforms(await request(app).get(`${ATTENDANCE}/sessions/${sessionId}`)); // 401
    api.conforms(await request(app).get(`${ATTENDANCE}/sessions/not-a-uuid`).set(mAuth)); // 400

    const own = api.conforms(await request(app).get(`${ATTENDANCE}/students/${s1.id}`).set(pAuth));
    expect(own.status).toBe(200);
    expect(own.body.data).toHaveLength(1);
    expect(api.conforms(await request(app).get(`${ATTENDANCE}/students/${s1.id}?sort=scheduledStart`).set(mAuth)).status).toBe(200);
    api.conforms(await request(app).get(`${ATTENDANCE}/students/${s1.id}`).set(p2Auth)); // 403 another Parent's child
    api.conforms(await request(app).get(`${ATTENDANCE}/students/${s1.id}`).set(tAuth)); // 403 a Teacher reads through the session
    api.conforms(await request(app).get(`${ATTENDANCE}/students/${s1.id}`).set(m2Auth)); // 403 another school
    api.conforms(await request(app).get(`${ATTENDANCE}/students/${UNKNOWN}`).set(mAuth)); // 403 unknown student
    api.conforms(await request(app).get(`${ATTENDANCE}/students/${s1.id}`)); // 401
    api.conforms(await request(app).get(`${ATTENDANCE}/students/not-a-uuid`).set(mAuth)); // 400
  });

  it('exercised every documented operation of Module 26', () => {
    expect(api.operationCount('26')).toBe(6);
    api.assertAllExercised('26');
  });
});
