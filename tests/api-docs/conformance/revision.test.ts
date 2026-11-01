import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { REVISION, createRevisionApi } from '../../helpers/revision-api-harness';
import { ApiConformance } from '../support/conformance';

const UNKNOWN = '00000000-0000-4000-8000-000000000000';
const THRESHOLD = new Date('2026-11-02T15:45:00Z'); // the 18:00 Cairo (UTC+2) slot runs 16:00Z-17:00Z
const IN_WINDOW = new Date('2026-11-02T16:10:00Z');
const AFTER_END = new Date('2026-11-02T17:30:00Z');
const GPS = { latitude: 30.0444 + 0.0004, longitude: 31.2357, accuracyMeters: 10 };
const RANGE = { unit: 'AYAHS', surah: 2, start: 1, amount: 3, direction: 'FORWARD' }; // Form A. The mini Quran: surah 2 has 6 ayahs
const OTHER_RANGE = { unit: 'AYAHS', surah: 2, start: 4, amount: 2, direction: 'FORWARD' };
const FROM_TO = { fromSurah: 2, toSurah: 3 }; // Form B: complete surahs, both ends included

describe('Module 28 endpoints conform to their OpenAPI documentation (real responses)', () => {
  let api: ApiConformance;
  beforeAll(async () => {
    api = await ApiConformance.create();
  });

  it('revision: assignments, records, corrections, reads, with their error responses', async () => {
    const { app, t, login, loginInitial } = await createRevisionApi();
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
    await t.classSessions.advanceDueSessions(); // the session is now IN_PROGRESS
    const assignments = `${REVISION}/sessions/${sessionId}/assignments`;
    const records = `${REVISION}/sessions/${sessionId}/records`;

    // an empty session
    const empty = api.conforms(await request(app).get(`${REVISION}/sessions/${sessionId}`).set(tAuth));
    expect(empty.body.data).toMatchObject({ scheduled: [], defined: [], records: [] });

    // define the next session's assignment (the session's Teacher, during the session)
    api.conforms(await request(app).post(assignments).set(tAuth).send({})); // 400 range missing
    api.conforms(await request(app).post(assignments).set(tAuth).send({ range: { unit: 'WORDS', start: 1, amount: 3, direction: 'FORWARD' } })); // 400 QURAN_RANGE_UNIT_INVALID
    api.conforms(await request(app).post(assignments).set(tAuth).send({ range: { unit: 'LINES', start: 1, amount: 3, direction: 'FORWARD' } })); // 400 REVISION_UNIT_NOT_SUPPORTED
    api.conforms(await request(app).post(assignments).set(tAuth).send({ range: { ...RANGE, fromSurah: 2, toSurah: 3 } })); // 400 REVISION_RANGE_FORM_INVALID
    api.conforms(await request(app).post(assignments).send({ range: RANGE })); // 401
    api.conforms(await request(app).post(assignments).set(mAuth).send({ range: RANGE })); // 403 a School Manager cannot
    api.conforms(await request(app).post(assignments).set(pAuth).send({ range: RANGE })); // 403
    api.conforms(await request(app).post(assignments).set(t2Auth).send({ range: RANGE })); // 403 Teacher of another group
    api.conforms(await request(app).post(`${REVISION}/sessions/${UNKNOWN}/assignments`).set(tAuth).send({ range: RANGE })); // 404
    api.conforms(await request(app).post(`${REVISION}/sessions/not-a-uuid/assignments`).set(tAuth).send({ range: RANGE })); // 400
    const perStudent = await request(app).post(assignments).set(tAuth).send({ studentId: s1.id, range: RANGE });
    expect(perStudent.body.error.code).toBe('REVISION_GROUP_ASSIGNMENT_NO_STUDENT'); // a collective group has ONE shared assignment
    api.conforms(perStudent);
    const tooFar = await request(app).post(assignments).set(tAuth).send({ range: { unit: 'AYAHS', surah: 3, start: 1, amount: 99, direction: 'FORWARD' } });
    expect(tooFar.body.error.code).toBe('QURAN_RANGE_EXCEEDS_QURAN');
    api.conforms(tooFar);
    const defined = api.conforms(await request(app).post(assignments).set(tAuth).send({ range: RANGE }));
    expect(defined.status).toBe(201);
    expect(defined.body.data).toMatchObject({ studentId: null, definedInSessionId: sessionId, status: 'ACTIVE' });
    const again = await request(app).post(assignments).set(tAuth).send({ range: OTHER_RANGE });
    expect(again.body.error.code).toBe('REVISION_ASSIGNMENT_ALREADY_DEFINED');
    api.conforms(again); // 409

    // modify and cancel it (only while the session is in progress)
    const assignmentUrl = `${REVISION}/assignments/${defined.body.data.id}`;
    api.conforms(await request(app).put(assignmentUrl).set(tAuth).send({})); // 400
    api.conforms(await request(app).put(assignmentUrl).send({ range: OTHER_RANGE })); // 401
    api.conforms(await request(app).put(assignmentUrl).set(mAuth).send({ range: OTHER_RANGE })); // 403
    api.conforms(await request(app).put(assignmentUrl).set(t2Auth).send({ range: OTHER_RANGE })); // 403
    api.conforms(await request(app).put(`${REVISION}/assignments/${UNKNOWN}`).set(tAuth).send({ range: OTHER_RANGE })); // 404
    api.conforms(await request(app).put(`${REVISION}/assignments/not-a-uuid`).set(tAuth).send({ range: OTHER_RANGE })); // 400
    const modified = api.conforms(await request(app).put(assignmentUrl).set(tAuth).send({ range: OTHER_RANGE }));
    expect(modified.status).toBe(200);
    expect(modified.body.data.range.first).toEqual({ surah: 2, ayah: 4 });
    const complete = api.conforms(await request(app).put(assignmentUrl).set(tAuth).send({ range: FROM_TO })); // Form B over HTTP
    expect(complete.body.data.range).toMatchObject({ input: { form: 'FROM_SURAH_TO_SURAH', fromSurah: 2, toSurah: 3 }, request: { unit: 'SURAHS', amount: 2, direction: 'FORWARD' }, ayahCount: 10 });
    api.conforms(await request(app).put(assignmentUrl).set(tAuth).send({ range: { ...RANGE, toSurah: 3 } })); // 400 REVISION_RANGE_FORM_INVALID
    api.conforms(await request(app).put(assignmentUrl).set(tAuth).send({ range: OTHER_RANGE }));
    api.conforms(await request(app).post(`${assignmentUrl}/cancel`).set(mAuth)); // 403
    api.conforms(await request(app).post(`${assignmentUrl}/cancel`)); // 401
    api.conforms(await request(app).post(`${REVISION}/assignments/${UNKNOWN}/cancel`).set(tAuth)); // 404
    const cancelled = api.conforms(await request(app).post(`${assignmentUrl}/cancel`).set(tAuth));
    expect(cancelled.body.data.status).toBe('CANCELLED');
    const twice = await request(app).post(`${assignmentUrl}/cancel`).set(tAuth);
    expect(twice.body.error.code).toBe('REVISION_ASSIGNMENT_CANCELLED');
    api.conforms(twice);
    const redefined = api.conforms(await request(app).post(assignments).set(tAuth).send({ range: RANGE })); // the slot is free after a cancellation
    expect(redefined.status).toBe(201);

    // record students' revision (the Teacher, Smart Guard)
    api.conforms(await request(app).post(records).set(tAuth).send({ gps: GPS })); // 400 records missing
    api.conforms(await request(app).post(records).set(tAuth).send({ gps: GPS, records: [{ studentId: s1.id, range: { unit: 'AYAHS', surah: 2, start: 99, amount: 1, direction: 'FORWARD' } }] })); // 400 QURAN_RANGE_START_INVALID
    const noGps = await request(app).post(records).set(tAuth).send({ records: [{ studentId: s1.id, range: RANGE }] });
    expect(noGps.body.error.code).toBe('SMART_GUARD_GPS_REQUIRED');
    api.conforms(noGps);
    const far = await request(app).post(records).set(tAuth).send({ gps: { ...GPS, latitude: 30.0444 + 0.00046 }, records: [{ studentId: s1.id, range: RANGE }] });
    expect(far.status).toBe(422);
    api.conforms(far);
    const notInGroup = await request(app).post(records).set(tAuth).send({ gps: GPS, records: [{ studentId: s1.id, range: RANGE }, { studentId: outsider.id, range: RANGE }] });
    expect(notInGroup.body.error.code).toBe('REVISION_STUDENT_NOT_IN_GROUP');
    api.conforms(notInGroup);
    api.conforms(await request(app).post(records).send({ gps: GPS, records: [{ studentId: s1.id, range: RANGE }] })); // 401
    api.conforms(await request(app).post(records).set(mAuth).send({ gps: GPS, records: [{ studentId: s1.id, range: RANGE }] })); // 403 a School Manager cannot record
    api.conforms(await request(app).post(records).set(pAuth).send({ gps: GPS, records: [{ studentId: s1.id, range: RANGE }] })); // 403
    api.conforms(await request(app).post(records).set(t2Auth).send({ gps: GPS, records: [{ studentId: s1.id, range: RANGE }] })); // 403
    api.conforms(await request(app).post(`${REVISION}/sessions/${UNKNOWN}/records`).set(tAuth).send({ gps: GPS, records: [{ studentId: s1.id, range: RANGE }] })); // 404
    api.conforms(await request(app).post(`${REVISION}/sessions/not-a-uuid/records`).set(tAuth).send({ gps: GPS, records: [] })); // 400
    const recorded = api.conforms(await request(app).post(records).set(tAuth).send({ gps: GPS, records: [{ studentId: s1.id, range: RANGE }, { studentId: s2.id, range: OTHER_RANGE }, { studentId: s2.id, range: RANGE }] }));
    expect(recorded.status).toBe(200);
    expect(recorded.body.data.results.map((r: { outcome: string }) => r.outcome)).toEqual(['RECORDED', 'RECORDED', 'RECORDED']); // several records for one student, each independent
    expect(recorded.body.data.results[0].record).toMatchObject({ assignmentId: null, matchesAssignment: null }); // nothing was scheduled for this session

    // correct a record (only during the same session; the original stays in the history)
    const recordUrl = `${REVISION}/records/${recorded.body.data.results[0].record.id}`;
    api.conforms(await request(app).put(recordUrl).set(tAuth).send({ gps: GPS })); // 400 range missing
    api.conforms(await request(app).put(recordUrl).set(tAuth).send({ gps: GPS, range: OTHER_RANGE, reason: 'a'.repeat(501) })); // 400
    const noGpsFix = await request(app).put(recordUrl).set(tAuth).send({ range: OTHER_RANGE });
    expect(noGpsFix.body.error.code).toBe('SMART_GUARD_GPS_REQUIRED');
    api.conforms(noGpsFix);
    api.conforms(await request(app).put(recordUrl).send({ gps: GPS, range: OTHER_RANGE })); // 401
    api.conforms(await request(app).put(recordUrl).set(mAuth).send({ gps: GPS, range: OTHER_RANGE })); // 403 a School Manager cannot correct
    api.conforms(await request(app).put(recordUrl).set(t2Auth).send({ gps: GPS, range: OTHER_RANGE })); // 403
    api.conforms(await request(app).put(`${REVISION}/records/${UNKNOWN}`).set(tAuth).send({ gps: GPS, range: OTHER_RANGE })); // 404
    api.conforms(await request(app).put(`${REVISION}/records/not-a-uuid`).set(tAuth).send({ gps: GPS, range: OTHER_RANGE })); // 400
    const fixed = api.conforms(await request(app).put(recordUrl).set(tAuth).send({ gps: GPS, range: OTHER_RANGE, reason: 'سبق لسان' }));
    expect(fixed.status).toBe(200);
    expect(fixed.body.data.outcome).toBe('CORRECTED');
    expect(fixed.body.data.record.range.first).toEqual({ surah: 2, ayah: 4 });
    expect((await request(app).put(recordUrl).set(tAuth).send({ gps: GPS, range: OTHER_RANGE })).body.data.outcome).toBe('UNCHANGED');
    expect(await t.revision.listCorrectionsOfSession(sessionId)).toHaveLength(1);
    expect((await t.revision.listCorrectionsOfSession(sessionId))[0]!.previousRange.first).toEqual({ surah: 2, ayah: 1 }); // the original is kept

    // reads
    const session = api.conforms(await request(app).get(`${REVISION}/sessions/${sessionId}`).set(mAuth));
    expect(session.status).toBe(200);
    expect(session.body.data.records).toHaveLength(3);
    expect(session.body.data.defined.map((a: { status: string }) => a.status).sort()).toEqual(['ACTIVE', 'CANCELLED']); // the cancelled one is kept
    expect(api.conforms(await request(app).get(`${REVISION}/sessions/${sessionId}`).set(tAuth)).status).toBe(200);
    api.conforms(await request(app).get(`${REVISION}/sessions/${sessionId}`).set(pAuth)); // 403 a Parent does not read a session
    api.conforms(await request(app).get(`${REVISION}/sessions/${sessionId}`).set(m2Auth)); // 403
    api.conforms(await request(app).get(`${REVISION}/sessions/${sessionId}`).set(t2Auth)); // 403
    api.conforms(await request(app).get(`${REVISION}/sessions/${UNKNOWN}`).set(mAuth)); // 404
    api.conforms(await request(app).get(`${REVISION}/sessions/${sessionId}`)); // 401
    api.conforms(await request(app).get(`${REVISION}/sessions/not-a-uuid`).set(mAuth)); // 400

    const own = api.conforms(await request(app).get(`${REVISION}/students/${s1.id}/records`).set(pAuth));
    expect(own.status).toBe(200);
    expect(own.body.data).toHaveLength(1);
    expect(api.conforms(await request(app).get(`${REVISION}/students/${s2.id}/records?sort=scheduledStart`).set(mAuth)).body.data).toHaveLength(2);
    api.conforms(await request(app).get(`${REVISION}/students/${s1.id}/records`).set(p2Auth)); // 403 another Parent's child
    api.conforms(await request(app).get(`${REVISION}/students/${s1.id}/records`).set(tAuth)); // 403 a Teacher reads through the session
    api.conforms(await request(app).get(`${REVISION}/students/${s1.id}/records`).set(m2Auth)); // 403 another school
    api.conforms(await request(app).get(`${REVISION}/students/${UNKNOWN}/records`).set(mAuth)); // 403 unknown student
    api.conforms(await request(app).get(`${REVISION}/students/${s1.id}/records`)); // 401
    api.conforms(await request(app).get(`${REVISION}/students/not-a-uuid/records`).set(mAuth)); // 400

    // the session ends: the assignment is final, the record is immutable
    t.sessionClock.set(AFTER_END);
    await t.classSessions.advanceDueSessions();
    const lateModify = await request(app).put(`${REVISION}/assignments/${redefined.body.data.id}`).set(tAuth).send({ range: OTHER_RANGE });
    expect(lateModify.body.error.code).toBe('REVISION_ASSIGNMENT_WINDOW_CLOSED');
    api.conforms(lateModify);
    const lateCancel = await request(app).post(`${REVISION}/assignments/${redefined.body.data.id}/cancel`).set(tAuth);
    expect(lateCancel.body.error.code).toBe('REVISION_ASSIGNMENT_WINDOW_CLOSED');
    api.conforms(lateCancel);
    const lateFix = await request(app).put(recordUrl).set(tAuth).send({ gps: GPS, range: RANGE });
    expect(lateFix.status).toBe(422);
    api.conforms(lateFix);
    expect((await t.revisionRepo.findAssignment(redefined.body.data.id))!.snapshot.range.first).toEqual({ surah: 2, ayah: 1 }); // untouched
    expect((await t.revisionRepo.findRecord(recorded.body.data.results[0].record.id))!.snapshot.range.first).toEqual({ surah: 2, ayah: 4 });
  });

  it('exercised every documented operation of Module 28', () => {
    expect(api.operationCount('28')).toBe(7);
    api.assertAllExercised('28');
  });
});
