import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { ATTENDANCE, EVALUATIONS, createEvaluationApi } from '../../helpers/evaluation-api-harness';
import { ApiConformance } from '../support/conformance';

const UNKNOWN = '00000000-0000-4000-8000-000000000000';
const at = (iso: string) => new Date(iso);
const GPS = { latitude: 30.0444 + 0.0004, longitude: 31.2357, accuracyMeters: 10 };
const MEM_RANGE = { start: { surah: 2, ayah: 1 }, unit: 'AYAHS', amount: 3, direction: 'FORWARD' };
const REV_RANGE = { unit: 'AYAHS', surah: 2, start: 4, amount: 2, direction: 'FORWARD' };
const ALL4 = (s: number) => [{ category: 'MEMORIZATION', score: s }, { category: 'REVISION', score: s }, { category: 'PERFORMANCE', score: s }, { category: 'TAJWEED', score: s }];

describe('Module 29 endpoints conform to their OpenAPI documentation (real responses)', () => {
  let api: ApiConformance;
  beforeAll(async () => {
    api = await ApiConformance.create();
  });

  it('evaluations: recording, modification, reads and every documented error response', async () => {
    const { app, t, login, loginInitial } = await createEvaluationApi();
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

    // session 1 defines the assignments; session 2 (2026-11-09 16:00Z-17:00Z) is evaluated
    t.sessionClock.set(at('2026-11-02T15:45:00Z'));
    await t.classSessions.generateDueSessions();
    const first = [...t.sessionRepo.rows.keys()][0]!;
    t.sessionClock.set(at('2026-11-02T16:10:00Z'));
    await t.classSessions.advanceDueSessions();
    await t.memorization.defineAssignment(first, teacher.userId, { range: MEM_RANGE });
    await t.revision.defineAssignment(first, teacher.userId, { range: REV_RANGE });
    t.sessionClock.set(at('2026-11-02T17:30:00Z'));
    await t.classSessions.advanceDueSessions();
    t.sessionClock.set(at('2026-11-09T15:45:00Z'));
    await t.classSessions.generateDueSessions();
    const sessionId = [...t.sessionRepo.rows.keys()].find((id) => id !== first)!;
    t.sessionClock.set(at('2026-11-09T16:10:00Z'));
    await t.classSessions.advanceDueSessions();
    const records = `${EVALUATIONS}/sessions/${sessionId}/records`;
    const body = (recordsList: unknown, gps: unknown = GPS) => ({ gps, records: recordsList });

    // ---- an empty session
    const empty = api.conforms(await request(app).get(`${EVALUATIONS}/sessions/${sessionId}`).set(tAuth));
    expect(empty.body.data).toMatchObject({ sessionId, evaluations: [] });

    // ---- 400
    api.conforms(await request(app).post(records).set(tAuth).send({ gps: GPS })); // records missing
    api.conforms(await request(app).post(records).set(tAuth).send(body([])));
    api.conforms(await request(app).post(records).set(tAuth).send(body([{ studentId: s1.id }]))); // EVALUATION_INVALID_RECORD
    api.conforms(await request(app).post(records).set(tAuth).send(body([{ studentId: s1.id, scores: [{ category: 'SPEED', score: 5 }] }])));
    api.conforms(await request(app).post(records).set(tAuth).send(body([{ studentId: s1.id, scores: [{ category: 'TAJWEED', score: 11 }] }]))); // EVALUATION_INVALID_SCORE
    api.conforms(await request(app).post(records).set(tAuth).send(body([{ studentId: s1.id, scores: ALL4(8), note: 'ب'.repeat(201) }]))); // EVALUATION_NOTE_TOO_LONG
    api.conforms(await request(app).post(records).set(tAuth).send({ records: [{ studentId: s1.id, scores: ALL4(8) }] })); // SMART_GUARD_GPS_REQUIRED
    api.conforms(await request(app).post(`${EVALUATIONS}/sessions/not-a-uuid/records`).set(tAuth).send(body([])));
    // ---- 401, 403, 404
    api.conforms(await request(app).post(records).send(body([{ studentId: s1.id, scores: ALL4(8) }])));
    api.conforms(await request(app).post(records).set(mAuth).send(body([{ studentId: s1.id, scores: ALL4(8) }]))); // the School Manager cannot write
    api.conforms(await request(app).post(records).set(pAuth).send(body([{ studentId: s1.id, scores: ALL4(8) }])));
    api.conforms(await request(app).post(records).set(t2Auth).send(body([{ studentId: s1.id, scores: ALL4(8) }]))); // a Teacher of another group
    api.conforms(await request(app).post(`${EVALUATIONS}/sessions/${UNKNOWN}/records`).set(tAuth).send(body([{ studentId: s1.id, scores: ALL4(8) }])));
    // ---- 422
    const outside = await request(app).post(records).set(tAuth).send(body([{ studentId: outsider.id, scores: ALL4(8) }]));
    expect(outside.body.error.code).toBe('EVALUATION_STUDENT_NOT_IN_GROUP');
    api.conforms(outside);
    const farAway = await request(app).post(records).set(tAuth).send(body([{ studentId: s1.id, scores: ALL4(8) }], { ...GPS, latitude: 31 }));
    expect(farAway.body.error.code).toBe('SMART_GUARD_OUTSIDE_SCHOOL_GEOFENCE');
    api.conforms(farAway);
    const partial = await request(app).post(records).set(tAuth).send(body([{ studentId: s1.id, scores: [{ category: 'MEMORIZATION', score: 8 }] }]));
    expect(partial.body.error.code).toBe('EVALUATION_CATEGORIES_MISMATCH');
    api.conforms(partial);
    await t.attendance.setStudentAttendanceByManager(sessionId, s2.id, manager.id, { status: 'ABSENT' });
    const absent = await request(app).post(records).set(tAuth).send(body([{ studentId: s2.id, scores: ALL4(8) }]));
    expect(absent.body.error.code).toBe('EVALUATION_STUDENT_ABSENT');
    api.conforms(absent);

    // ---- 200: create, modify, unchanged, note immutable
    const created = api.conforms(await request(app).post(records).set(tAuth).send(body([{ studentId: s1.id, scores: ALL4(8.555), note: 'أداء ممتاز' }])));
    expect(created.status).toBe(200);
    expect(created.body.data.results[0]).toMatchObject({ studentId: s1.id, outcome: 'RECORDED' });
    expect(created.body.data.results[0].evaluation.scores.map((x: { score: number }) => x.score)).toEqual([8.56, 8.56, 8.56, 8.56]); // rounded, not rejected
    expect(created.body.data.results[0].evaluation).not.toHaveProperty('updatedAt'); // nothing about modifications is exposed
    const changed = api.conforms(await request(app).post(records).set(tAuth).send(body([{ studentId: s1.id, scores: [{ category: 'TAJWEED', score: 4 }] }])));
    expect(changed.body.data.results[0].outcome).toBe('UPDATED');
    const same = api.conforms(await request(app).post(records).set(tAuth).send(body([{ studentId: s1.id, scores: [{ category: 'TAJWEED', score: 4 }] }])));
    expect(same.body.data.results[0].outcome).toBe('UNCHANGED');
    const noteChange = await request(app).post(records).set(tAuth).send(body([{ studentId: s1.id, scores: [{ category: 'TAJWEED', score: 5 }], note: 'تغيير' }]));
    expect(noteChange.body.error.code).toBe('EVALUATION_NOTE_IMMUTABLE');
    api.conforms(noteChange);
    // an evaluated student cannot be marked ABSENT (Attendance's endpoint)
    const absentNow = await request(app).put(`${ATTENDANCE}/sessions/${sessionId}/students/${s1.id}`).set(mAuth).send({ status: 'ABSENT', reason: 'خطأ' });
    expect(absentNow.status).toBe(422);
    expect(absentNow.body.error.code).toBe('ATTENDANCE_STUDENT_ALREADY_EVALUATED');

    // ---- reads
    const session = api.conforms(await request(app).get(`${EVALUATIONS}/sessions/${sessionId}`).set(mAuth));
    expect(session.body.data.evaluations).toHaveLength(1);
    expect(session.body.data.evaluations[0]).toMatchObject({ note: 'أداء ممتاز' });
    api.conforms(await request(app).get(`${EVALUATIONS}/sessions/${sessionId}`).set(tAuth));
    api.conforms(await request(app).get(`${EVALUATIONS}/sessions/${sessionId}`).set(t2Auth)); // 403
    api.conforms(await request(app).get(`${EVALUATIONS}/sessions/${sessionId}`).set(pAuth)); // 403
    api.conforms(await request(app).get(`${EVALUATIONS}/sessions/${sessionId}`).set(m2Auth)); // 403 another school's manager
    api.conforms(await request(app).get(`${EVALUATIONS}/sessions/${UNKNOWN}`).set(tAuth)); // 404
    const parentView = api.conforms(await request(app).get(`${EVALUATIONS}/students/${s1.id}`).set(pAuth));
    expect(parentView.body.data[0]).toMatchObject({ studentId: s1.id, note: 'أداء ممتاز' });
    expect(parentView.body.data[0].scores.find((x: { category: string }) => x.category === 'TAJWEED').score).toBe(4); // the current score only
    api.conforms(await request(app).get(`${EVALUATIONS}/students/${s1.id}`).set(mAuth)); // the School Manager reads grades and notes
    api.conforms(await request(app).get(`${EVALUATIONS}/students/${s1.id}`).set(p2Auth)); // 403 another Parent
    api.conforms(await request(app).get(`${EVALUATIONS}/students/${s1.id}`).set(tAuth)); // 403 a Teacher has no student-level read
    api.conforms(await request(app).get(`${EVALUATIONS}/students/${s1.id}`).set(m2Auth)); // 403
    api.conforms(await request(app).get(`${EVALUATIONS}/students/${s1.id}`)); // 401

    // ---- the grace period and the closed window
    t.sessionClock.set(at('2026-11-09T17:05:00Z'));
    const grace = await request(app).post(records).set(tAuth).send(body([{ studentId: s1.id, scores: [{ category: 'TAJWEED', score: 1 }] }]));
    expect(grace.body.error.code).toBe('EVALUATION_GRACE_CREATE_ONLY');
    api.conforms(grace);
    t.sessionClock.set(at('2026-11-09T17:15:01Z'));
    const closed = await request(app).post(records).set(tAuth).send(body([{ studentId: s1.id, scores: ALL4(1) }]));
    expect(closed.body.error.code).toBe('SMART_GUARD_OUTSIDE_SESSION_WINDOW');
    api.conforms(closed);
  });

  it('exercised every documented operation of Module 29', () => {
    expect(api.operationCount('29')).toBe(3);
    api.assertAllExercised('29');
  });
});
