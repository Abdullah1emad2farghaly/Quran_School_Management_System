import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { EXAMS, createExamApi } from '../../helpers/exam-api-harness';
import { ApiConformance } from '../support/conformance';

const UNKNOWN = '00000000-0000-4000-8000-000000000000';
const at = (iso: string) => new Date(iso);
const GPS = { latitude: 30.0444 + 0.0004, longitude: 31.2357, accuracyMeters: 10 }; // about 44 m from the school's official GPS
const START = '2026-12-01T09:00:00.000Z';
const END = '2026-12-01T11:00:00.000Z';

describe('Module 30 endpoints conform to their OpenAPI documentation (real responses, real authorization)', () => {
  let api: ApiConformance;
  beforeAll(async () => {
    api = await ApiConformance.create();
  });

  it('exams: configuration, lifecycle, examiners, results, reads, and every permission rule', async () => {
    const { app, t, login, loginInitial, phoneOf } = await createExamApi();
    t.sessionClock.set(at('2026-11-20T08:00:00Z'));
    const school = await t.newSchool('مدرسة أ');
    const school2 = await t.newSchool('مدرسة ب');
    const manager = await t.newSchoolManager(school.id);
    const manager2 = await t.newSchoolManager(school2.id);
    const mAuth = await login(manager);
    const m2Auth = await login(manager2);
    const teacher1 = await t.newTeacher(school.id, manager.id); // the examiner
    const teacher2 = await t.newTeacher(school.id, manager.id); // a Teacher who is NOT an examiner
    const foreign = await t.newTeacher(school2.id, manager2.id); // a Teacher of another school
    const parent = await t.newParent(school.id, manager.id);
    const parent2 = await t.newParent(school.id, manager.id);
    const group = await t.newGroup(school.id, manager.id, { teacherId: teacher2.id });
    const s1 = await t.registerStudent(school.id, parent.id, manager.id);
    const s2 = await t.registerStudent(school.id, parent.id, manager.id);
    const s3 = await t.registerStudent(school.id, parent2.id, manager.id);
    const outsider = await t.registerStudent(school.id, parent.id, manager.id);
    for (const s of [s1, s2, s3]) await t.groups.assignStudent(group.id, s.id, manager.id);
    const tAuth = await loginInitial(await phoneOf(teacher1.userId));
    const t2Auth = await loginInitial(await phoneOf(teacher2.userId));
    const pAuth = await loginInitial(await phoneOf(parent.userId));
    const p2Auth = await loginInitial(await phoneOf(parent2.userId));
    const base = { schoolId: school.id, startAt: START, endAt: END, questionCount: 3, maxScore: 10, groupIds: [group.id], examinerTeacherIds: [teacher1.id] };
    const post = (path: string, auth: Record<string, string> | undefined, body?: unknown) => { const r = request(app).post(`${EXAMS}${path}`); return (auth ? r.set(auth) : r).send(body as never); };
    const get = (path: string, auth?: Record<string, string>) => { const r = request(app).get(`${EXAMS}${path}`); return auth ? r.set(auth) : r; };
    const created = async (over: Record<string, unknown> = {}) => (api.conforms(await post('', mAuth, { ...base, ...over })).body.data as { id: string });
    const startAndRun = async (iso = '2026-12-01T09:00:01Z') => { t.sessionClock.set(at(iso)); await t.exams.runCycle(); };

    // ---- create: 400, 401, 403, 422
    api.conforms(await post('', mAuth, { schoolId: school.id }));
    api.conforms(await post('', mAuth, { ...base, questionCount: 0 }));
    const noTarget = await post('', mAuth, { ...base, groupIds: [] });
    expect(noTarget.body.error.code).toBe('EXAM_TARGET_REQUIRED');
    api.conforms(noTarget);
    api.conforms(await post('', mAuth, { ...base, endAt: START })); // EXAM_INVALID_END
    api.conforms(await post('', undefined, base));
    for (const auth of [tAuth, t2Auth, pAuth, m2Auth]) api.conforms(await post('', auth, base)); // a Teacher, a Parent, another school's manager: 403
    const badExaminer = await post('', mAuth, { ...base, examinerTeacherIds: [foreign.id] });
    expect(badExaminer.body.error.code).toBe('EXAM_EXAMINER_NOT_ELIGIBLE');
    api.conforms(badExaminer);
    const badGroup = await post('', mAuth, { ...base, groupIds: [UNKNOWN] });
    expect(badGroup.body.error.code).toBe('EXAM_INVALID_TARGET');
    api.conforms(badGroup);

    // ---- a DRAFT: edit, and who can see it
    const draft = await created();
    expect((await get(`/${draft.id}`, mAuth)).body.data.status).toBe('DRAFT');
    api.conforms(await get(`/${draft.id}`, mAuth));
    api.conforms(await get(`/${draft.id}`, tAuth)); // an examiner does not see a DRAFT: 403
    expect((await get(`/${draft.id}`, tAuth)).status).toBe(403);
    const edited = api.conforms(await request(app).patch(`${EXAMS}/${draft.id}`).set(mAuth).send({ questionCount: 4, maxScore: 7.555 }));
    expect([edited.body.data.questionCount, edited.body.data.maxScore, edited.body.data.maxTotal]).toEqual([4, 7.56, 30.24]);
    api.conforms(await request(app).patch(`${EXAMS}/${draft.id}`).set(mAuth).send({ questionCount: 500 }));
    api.conforms(await request(app).patch(`${EXAMS}/${draft.id}`).set(t2Auth).send({ questionCount: 4 }));
    api.conforms(await request(app).patch(`${EXAMS}/${draft.id}`).set(tAuth).send({ questionCount: 4 })); // an examiner cannot edit

    // ---- delete and cancel are separate; schedule
    const toDelete = await created();
    api.conforms(await request(app).delete(`${EXAMS}/${toDelete.id}`).set(tAuth)); // 403
    const deleted = await request(app).delete(`${EXAMS}/${toDelete.id}`).set(mAuth);
    expect(deleted.status).toBe(204);
    api.conforms(deleted);
    expect((await get(`/${toDelete.id}`, mAuth)).status).toBe(403); // a deleted exam does not exist for anyone
    const toCancel = await created();
    api.conforms(await post(`/${toCancel.id}/schedule`, mAuth));
    const cancelled = api.conforms(await post(`/${toCancel.id}/cancel`, mAuth));
    expect(cancelled.body.data.status).toBe('CANCELLED');
    const cancelTwice = await post(`/${toCancel.id}/cancel`, mAuth);
    expect(cancelTwice.body.error.code).toBe('EXAM_INVALID_TRANSITION');
    api.conforms(cancelTwice);
    api.conforms(await post(`/${draft.id}/schedule`, t2Auth));
    const exam = await created(); // the main exam: with an end time, two groups' worth of students
    expect(api.conforms(await post(`/${exam.id}/schedule`, mAuth)).body.data.status).toBe('SCHEDULED');
    await t.groups.assignStudent((await t.newGroup(school.id, manager.id, { teacherId: teacher2.id })).id, outsider.id, manager.id); // a student of ANOTHER group

    // ---- reads before the start
    const listed = api.conforms(await get(`/schools/${school.id}`, mAuth));
    expect(listed.body.data.map((e: { id: string }) => e.id)).toContain(exam.id);
    api.conforms(await get(`/schools/${school.id}?status=SCHEDULED,STARTED&sort=startAt`, mAuth));
    for (const auth of [tAuth, pAuth, m2Auth]) api.conforms(await get(`/schools/${school.id}`, auth)); // 403
    const asExaminer = api.conforms(await get(`/${exam.id}`, tAuth));
    expect(JSON.stringify(asExaminer.body.data)).not.toMatch(/"(scores|results|recordedAt)"/);
    for (const auth of [t2Auth, pAuth, p2Auth, m2Auth]) api.conforms(await get(`/${exam.id}`, auth)); // not assigned / not allowed: 403
    api.conforms(await get(`/${exam.id}`));
    const assigned = api.conforms(await get('/assigned', tAuth));
    expect(assigned.body.data.map((e: { id: string }) => e.id)).toEqual([exam.id]);
    expect(api.conforms(await get('/assigned', t2Auth)).body.data).toEqual([]);
    api.conforms(await get('/assigned', pAuth)); // a Parent has no examiner permission: 403
    const schedule = api.conforms(await get('/schedule', pAuth));
    expect(schedule.body.data.map((e: { id: string }) => e.id)).toContain(exam.id);
    expect(schedule.body.data.map((e: { id: string }) => e.id)).not.toContain(draft.id); // a DRAFT is not a schedule
    api.conforms(await get('/schedule', tAuth)); // 403
    const groups = api.conforms(await get(`/${exam.id}/groups`, tAuth));
    expect(groups.body.data).toEqual([{ groupId: group.id, groupName: expect.any(String), total: 3, pending: 3 }]);
    const pendingLive = api.conforms(await get(`/${exam.id}/groups/${group.id}/students?pageSize=2`, tAuth));
    expect(pendingLive.body.data.map((s: { examinationStatus: string }) => s.examinationStatus)).toEqual(['PENDING', 'PENDING']);
    api.conforms(await get(`/${exam.id}/groups/${group.id}/students`, t2Auth)); // 403
    // a result cannot be recorded before the exam started: Smart Guard's window opens 15 minutes before the start, and even inside it the exam must be STARTED
    const tooEarly = await post(`/${exam.id}/results`, tAuth, { studentId: s1.id, scores: [1, 2, 3], gps: GPS });
    expect(tooEarly.body.error.code).toBe('SMART_GUARD_OUTSIDE_SESSION_WINDOW');
    api.conforms(tooEarly);
    t.sessionClock.set(at('2026-12-01T08:50:00Z'));
    const early = await post(`/${exam.id}/results`, tAuth, { studentId: s1.id, scores: [1, 2, 3], gps: GPS });
    expect(early.body.error.code).toBe('EXAM_NOT_STARTED');
    api.conforms(early);

    // ---- STARTED: the examiner records results through Smart Guard
    await startAndRun();
    expect((await get(`/${exam.id}`, mAuth)).body.data.status).toBe('STARTED');
    api.conforms(await request(app).patch(`${EXAMS}/${exam.id}`).set(mAuth).send({ questionCount: 9 })); // locked
    const record = (studentId: string, scores: unknown, extra: Record<string, unknown> = {}) => post(`/${exam.id}/results`, tAuth, { studentId, scores, gps: GPS, ...extra });
    const ok = api.conforms(await record(s1.id, [8, 9.5, 7.555]));
    expect(ok.status).toBe(201);
    expect(ok.body.data).toEqual({ examId: exam.id, studentId: s1.id, groupId: group.id });
    const again = await record(s1.id, [1, 1, 1]);
    expect(again.body.error.code).toBe('EXAM_RESULT_ALREADY_RECORDED');
    api.conforms(again);
    api.conforms(await record(s2.id, [1, 2])); // EXAM_INVALID_SCORES
    api.conforms(await record(s2.id, [1, 2, 11])); // EXAM_SCORE_OUT_OF_RANGE
    api.conforms(await post(`/${exam.id}/results`, tAuth, { studentId: s2.id, scores: [1, 2, 3] })); // SMART_GUARD_GPS_REQUIRED
    const far = await record(s2.id, [1, 2, 3], { gps: { ...GPS, latitude: 31 } });
    expect(far.body.error.code).toBe('SMART_GUARD_OUTSIDE_SCHOOL_GEOFENCE');
    api.conforms(far);
    const notTarget = await record(outsider.id, [1, 2, 3]);
    expect(notTarget.body.error.code).toBe('EXAM_STUDENT_NOT_TARGET');
    api.conforms(notTarget);
    for (const auth of [t2Auth, mAuth, pAuth]) api.conforms(await post(`/${exam.id}/results`, auth, { studentId: s2.id, scores: [1, 2, 3], gps: GPS })); // 403: not an examiner
    api.conforms(await post(`/${exam.id}/results`, undefined, { studentId: s2.id, scores: [1, 2, 3], gps: GPS }));
    // the examiner NEVER reads a result, not even their own; the pending list no longer shows the examined student
    api.conforms(await get(`/${exam.id}/results`, tAuth));
    expect((await get(`/${exam.id}/results`, tAuth)).status).toBe(403);
    const pendingNow = api.conforms(await get(`/${exam.id}/groups/${group.id}/students`, tAuth));
    expect(pendingNow.body.data.map((s: { studentId: string }) => s.studentId).sort()).toEqual([s2.id, s3.id].sort());
    expect(api.conforms(await get(`/${exam.id}/groups`, tAuth)).body.data[0]).toMatchObject({ total: 3, pending: 2 });
    // the School Manager reads all recorded results
    const results = api.conforms(await get(`/${exam.id}/results`, mAuth));
    expect(results.body.data.results).toEqual([expect.objectContaining({ studentId: s1.id, scores: [8, 9.5, 7.56], total: 25.06, maxTotal: 30 })]);
    for (const auth of [t2Auth, pAuth, m2Auth]) api.conforms(await get(`/${exam.id}/results`, auth));

    // ---- examiners can change after STARTED; the end time is editable with the future rule
    const teacher3 = await t.newTeacher(school.id, manager.id);
    const added = api.conforms(await post(`/${exam.id}/examiners`, mAuth, { teacherId: teacher3.id }));
    expect(added.status).toBe(201);
    const dup = await post(`/${exam.id}/examiners`, mAuth, { teacherId: teacher3.id });
    expect(dup.body.error.code).toBe('EXAM_EXAMINER_ALREADY_ASSIGNED');
    api.conforms(dup);
    const notEligible = await post(`/${exam.id}/examiners`, mAuth, { teacherId: foreign.id });
    expect(notEligible.body.error.code).toBe('EXAM_EXAMINER_NOT_ELIGIBLE');
    api.conforms(notEligible);
    api.conforms(await post(`/${exam.id}/examiners`, tAuth, { teacherId: teacher3.id })); // an examiner cannot manage examiners
    const removed = api.conforms(await request(app).delete(`${EXAMS}/${exam.id}/examiners/${teacher3.id}`).set(mAuth));
    expect(removed.body.data.examiners.map((e: { teacherId: string }) => e.teacherId)).toEqual([teacher1.id]);
    const notAssigned = await request(app).delete(`${EXAMS}/${exam.id}/examiners/${teacher3.id}`).set(mAuth);
    expect(notAssigned.body.error.code).toBe('EXAM_EXAMINER_NOT_ASSIGNED');
    api.conforms(notAssigned);
    api.conforms(await request(app).delete(`${EXAMS}/${exam.id}/examiners/${teacher1.id}`).set(tAuth)); // 403
    const putEnd = (auth: Record<string, string>, endAt: string) => request(app).put(`${EXAMS}/${exam.id}/end-time`).set(auth).send({ endAt });
    const past = await putEnd(mAuth, '2026-12-01T09:00:00.000Z');
    expect(past.body.error.code).toBe('EXAM_END_NOT_IN_FUTURE');
    api.conforms(past);
    api.conforms(await request(app).put(`${EXAMS}/${exam.id}/end-time`).set(mAuth).send({ endAt: 'tomorrow' }));
    api.conforms(await putEnd(tAuth, '2026-12-01T12:00:00.000Z'));
    expect(api.conforms(await putEnd(mAuth, '2026-12-01T12:00:00.000Z')).body.data.endAt).toBe('2026-12-01T12:00:00.000Z');
    const manual = await post(`/${exam.id}/complete`, mAuth);
    expect(manual.body.error.code).toBe('EXAM_END_TIME_DEFINED');
    api.conforms(manual);
    api.conforms(await post(`/${exam.id}/end`, mAuth)); // not COMPLETED yet: 422
    api.conforms(await post(`/${exam.id}/cancel`, mAuth)); // no cancellation after STARTED: 422

    // ---- COMPLETED by the clock (the extended end time decides): the unexamined become ABSENT
    t.sessionClock.set(at('2026-12-01T11:30:00Z'));
    await t.exams.runCycle();
    expect((await get(`/${exam.id}`, mAuth)).body.data.status).toBe('STARTED'); // the extension held
    t.sessionClock.set(at('2026-12-01T12:00:01Z'));
    await t.exams.runCycle();
    expect((await get(`/${exam.id}`, mAuth)).body.data.status).toBe('COMPLETED');
    const closed = await record(s2.id, [1, 2, 3]); // after the end Smart Guard's window is closed first
    expect(closed.body.error.code).toBe('SMART_GUARD_OUTSIDE_SESSION_WINDOW');
    api.conforms(closed);
    const lockedEnd = await putEnd(mAuth, '2027-01-01T00:00:00.000Z');
    expect(lockedEnd.body.error.code).toBe('EXAM_LOCKED');
    api.conforms(lockedEnd);
    const afterComplete = api.conforms(await get(`/${exam.id}/results`, mAuth));
    expect(afterComplete.body.data.absent.map((a: { studentId: string }) => a.studentId).sort()).toEqual([s2.id, s3.id].sort());
    expect(afterComplete.body.data.results).toHaveLength(1); // no zero-score result was invented for the absent
    // the Parent sees ONLY their own children's recorded result / ABSENT status
    const own = api.conforms(await get(`/students/${s1.id}`, pAuth));
    expect(own.body.data[0]).toMatchObject({ outcome: 'EXAMINED', result: { scores: [8, 9.5, 7.56], total: 25.06, maxTotal: 30 } });
    expect(api.conforms(await get(`/students/${s2.id}`, pAuth)).body.data[0]).toMatchObject({ outcome: 'ABSENT', result: null });
    api.conforms(await get(`/students/${s3.id}`, pAuth)); // another family's child: 403
    api.conforms(await get(`/students/${s1.id}`, p2Auth)); // 403
    expect(api.conforms(await get(`/students/${s3.id}`, p2Auth)).body.data[0]).toMatchObject({ outcome: 'ABSENT' });
    api.conforms(await get(`/students/${s1.id}`, mAuth)); // the School Manager of the school
    for (const auth of [tAuth, t2Auth, m2Auth]) api.conforms(await get(`/students/${s1.id}`, auth)); // 403
    // the examiner keeps their access until ENDED, and loses ALL of it at ENDED
    expect((await get(`/${exam.id}`, tAuth)).status).toBe(200);
    const ended = api.conforms(await post(`/${exam.id}/end`, mAuth));
    expect(ended.body.data).toMatchObject({ status: 'ENDED', examiners: [] });
    for (const path of [`/${exam.id}`, `/${exam.id}/groups`, `/${exam.id}/groups/${group.id}/students`]) expect((await get(path, tAuth)).status).toBe(403);
    expect((await record(s2.id, [1, 2, 3])).status).toBe(403);
    expect(api.conforms(await get('/assigned', tAuth)).body.data).toEqual([]);
    const lockedAfterEnd = await post(`/${exam.id}/examiners`, mAuth, { teacherId: teacher3.id });
    expect(lockedAfterEnd.body.error.code).toBe('EXAM_LOCKED');
    api.conforms(lockedAfterEnd);
    const second = await post(`/${exam.id}/end`, mAuth);
    expect(second.body.error.code).toBe('EXAM_INVALID_TRANSITION'); // one-way
    expect(api.conforms(await get(`/${exam.id}/results`, mAuth)).body.data.results).toHaveLength(1); // everything preserved
    // the underlying Teacher role is untouched: the same account still works as a Teacher elsewhere (its own exam-less listing)
    expect((await get('/assigned', tAuth)).status).toBe(200);

    // ---- an exam WITHOUT an end time: manual completion, and an examiner removed while STARTED loses the right at once
    t.sessionClock.set(at('2026-12-10T08:00:00Z'));
    const open = await created({ startAt: '2026-12-11T09:00:00.000Z', endAt: null });
    api.conforms(await post(`/${open.id}/schedule`, mAuth));
    t.sessionClock.set(at('2026-12-11T09:00:01Z'));
    await t.exams.runCycle();
    const openRecord = (studentId: string) => post(`/${open.id}/results`, tAuth, { studentId, scores: [3, 3, 3], gps: GPS });
    expect((await openRecord(s1.id)).status).toBe(201);
    api.conforms(await request(app).delete(`${EXAMS}/${open.id}/examiners/${teacher1.id}`).set(mAuth));
    expect((await openRecord(s2.id)).status).toBe(403); // removed: the exam-scoped permission is gone immediately
    api.conforms(await post(`/${open.id}/examiners`, mAuth, { teacherId: teacher1.id }));
    expect((await openRecord(s2.id)).status).toBe(201); // assigned again
    t.sessionClock.set(at('2027-06-01T00:00:00Z'));
    await t.exams.runCycle();
    expect((await get(`/${open.id}`, mAuth)).body.data.status).toBe('STARTED'); // no end time: never completes by itself
    expect(api.conforms(await post(`/${open.id}/complete`, mAuth)).body.data.status).toBe('COMPLETED');
    api.conforms(await post(`/${open.id}/complete`, t2Auth)); // 403
    const afterManual = await openRecord(s3.id); // no end time: the window is open-ended, so it is the exam status that closes submissions
    expect(afterManual.body.error.code).toBe('EXAM_SUBMISSION_CLOSED');
    api.conforms(afterManual);
  });

  it('exercised every documented operation of Module 30', () => {
    expect(api.operationCount('30')).toBe(19);
    api.assertAllExercised('30');
  });
});
