import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { SESSIONS, createClassSessionsApi } from '../../helpers/class-sessions-api-harness';
import { ApiConformance } from '../support/conformance';

const UNKNOWN = '00000000-0000-4000-8000-000000000000';
const MONDAY_THRESHOLD = new Date('2026-11-02T15:45:00Z'); // the 18:00 Cairo (UTC+2) slot starts at 16:00Z
const NEXT_MONDAY_THRESHOLD = new Date('2026-11-09T15:45:00Z');

describe('Module 24 endpoints conform to their OpenAPI documentation (real responses)', () => {
  let api: ApiConformance;
  beforeAll(async () => {
    api = await ApiConformance.create();
  });

  it('sessions: list own, list by group, read one and cancel, with their error responses', async () => {
    const { app, t, login, loginInitial } = await createClassSessionsApi();
    const school = await t.newSchool('مدرسة أ');
    const school2 = await t.newSchool('مدرسة ب');
    const manager = await t.newSchoolManager(school.id);
    const manager2 = await t.newSchoolManager(school2.id);
    const auth = await login(manager);
    const auth2 = await login(manager2);
    const teacher = await t.newTeacher(school.id, manager.id);
    const teacher2 = await t.newTeacher(school.id, manager.id);
    const parent = await t.newParent(school.id, manager.id);
    const group = await t.newGroup(school.id, manager.id, { teacherId: teacher.id });
    await t.schedules.addSlot(group.id, { dayOfWeek: 'MONDAY', startTime: '18:00', endTime: '19:00' }, manager.id);
    const tAuth = await loginInitial((await t.h.identity.findById(teacher.userId))!.phone);
    const t2Auth = await loginInitial((await t.h.identity.findById(teacher2.userId))!.phone);
    const pAuth = await loginInitial((await t.h.identity.findById(parent.userId))!.phone);

    // the system creates the session when its threshold is reached
    t.sessionClock.set(MONDAY_THRESHOLD);
    expect((await t.classSessions.generateDueSessions()).created).toBe(1);
    const sessionId = [...t.sessionRepo.rows.keys()][0]!;

    // list own (Teacher only)
    const mine = api.conforms(await request(app).get(`${SESSIONS}/mine`).set(tAuth));
    expect(mine.status).toBe(200);
    expect(mine.body.data).toHaveLength(1);
    api.conforms(await request(app).get(`${SESSIONS}/mine?filter[status]=OPEN&sort=-scheduledStart`).set(tAuth));
    api.conforms(await request(app).get(`${SESSIONS}/mine?filter[status]=NOPE`).set(tAuth)); // 400
    api.conforms(await request(app).get(`${SESSIONS}/mine`).set(auth)); // 403 a manager has no own sessions
    api.conforms(await request(app).get(`${SESSIONS}/mine`).set(pAuth)); // 403
    api.conforms(await request(app).get(`${SESSIONS}/mine`)); // 401
    expect((await request(app).get(`${SESSIONS}/mine`).set(t2Auth)).body.data).toHaveLength(0); // another Teacher has none

    // list by group
    expect(api.conforms(await request(app).get(`${SESSIONS}/groups/${group.id}`).set(auth)).status).toBe(200);
    expect(api.conforms(await request(app).get(`${SESSIONS}/groups/${group.id}`).set(tAuth)).status).toBe(200);
    api.conforms(await request(app).get(`${SESSIONS}/groups/${group.id}?filter[status]=OPEN`).set(auth));
    api.conforms(await request(app).get(`${SESSIONS}/groups/${group.id}`).set(pAuth)); // 403 Parent
    api.conforms(await request(app).get(`${SESSIONS}/groups/${group.id}`).set(auth2)); // 403 another school's manager
    api.conforms(await request(app).get(`${SESSIONS}/groups/${group.id}`).set(t2Auth)); // 403 Teacher of another group
    api.conforms(await request(app).get(`${SESSIONS}/groups/${UNKNOWN}`).set(auth)); // 403 unknown group
    api.conforms(await request(app).get(`${SESSIONS}/groups/not-a-uuid`).set(auth)); // 400
    api.conforms(await request(app).get(`${SESSIONS}/groups/${group.id}`)); // 401

    // read one
    const one = api.conforms(await request(app).get(`${SESSIONS}/${sessionId}`).set(auth));
    expect(one.status).toBe(200);
    expect(one.body.data).toMatchObject({ id: sessionId, groupId: group.id, status: 'OPEN', teacherId: teacher.id, occurrenceDate: '2026-11-02', scheduledStart: '2026-11-02T16:00:00.000Z' });
    expect(api.conforms(await request(app).get(`${SESSIONS}/${sessionId}`).set(tAuth)).status).toBe(200);
    api.conforms(await request(app).get(`${SESSIONS}/${sessionId}`).set(pAuth)); // 403
    api.conforms(await request(app).get(`${SESSIONS}/${sessionId}`).set(auth2)); // 403
    api.conforms(await request(app).get(`${SESSIONS}/${UNKNOWN}`).set(auth)); // 404
    api.conforms(await request(app).get(`${SESSIONS}/not-a-uuid`).set(auth)); // 400
    api.conforms(await request(app).get(`${SESSIONS}/${sessionId}`)); // 401

    // cancel: validation first, then permission, then the business rules
    api.conforms(await request(app).post(`${SESSIONS}/${sessionId}/cancel`).set(tAuth).send({})); // 400 reason missing
    const blank = await request(app).post(`${SESSIONS}/${sessionId}/cancel`).set(tAuth).send({ reason: '   ' });
    expect(blank.body.error.code).toBe('CLASS_SESSION_CANCEL_REASON_REQUIRED');
    api.conforms(blank);
    const long = await request(app).post(`${SESSIONS}/${sessionId}/cancel`).set(tAuth).send({ reason: 'x'.repeat(501) });
    expect(long.body.error.code).toBe('CLASS_SESSION_CANCEL_REASON_TOO_LONG');
    api.conforms(long);
    api.conforms(await request(app).post(`${SESSIONS}/${sessionId}/cancel`).set(tAuth).send({ reason: 5 })); // 400 type
    api.conforms(await request(app).post(`${SESSIONS}/not-a-uuid/cancel`).set(tAuth).send({ reason: 'x' })); // 400
    api.conforms(await request(app).post(`${SESSIONS}/${sessionId}/cancel`).send({ reason: 'x' })); // 401
    api.conforms(await request(app).post(`${SESSIONS}/${sessionId}/cancel`).set(auth).send({ reason: 'x' })); // 403 a manager cannot cancel
    api.conforms(await request(app).post(`${SESSIONS}/${sessionId}/cancel`).set(pAuth).send({ reason: 'x' })); // 403
    api.conforms(await request(app).post(`${SESSIONS}/${UNKNOWN}/cancel`).set(tAuth).send({ reason: 'x' })); // 404
    t.sessionClock.set(new Date('2026-11-02T15:50:00Z'));
    const cancelled = api.conforms(await request(app).post(`${SESSIONS}/${sessionId}/cancel`).set(tAuth).send({ reason: 'المعلم في إجازة مرضية' }));
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data).toMatchObject({ status: 'CANCELLED', cancelSource: 'TEACHER', cancelReason: 'المعلم في إجازة مرضية', cancelledAt: '2026-11-02T15:50:00.000Z', slotRetireReason: null });
    const again = await request(app).post(`${SESSIONS}/${sessionId}/cancel`).set(tAuth).send({ reason: 'مرة أخرى' });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('CLASS_SESSION_NOT_CANCELLABLE');
    api.conforms(again);
    expect((await request(app).get(`${SESSIONS}/${sessionId}`).set(auth)).body.data.cancelReason).toBe('المعلم في إجازة مرضية'); // the original is kept

    // a different Teacher of the group is not the session's Teacher
    t.sessionClock.set(NEXT_MONDAY_THRESHOLD);
    await t.classSessions.generateDueSessions();
    const nextId = [...t.sessionRepo.rows.values()].find((s) => s.occurrenceDate === '2026-11-09')!.id;
    await t.groups.assignTeacher(group.id, teacher2.id, manager.id);
    const notYours = await request(app).post(`${SESSIONS}/${nextId}/cancel`).set(t2Auth).send({ reason: 'x' });
    expect(notYours.status).toBe(403);
    expect(notYours.body.error.code).toBe('CLASS_SESSION_NOT_ASSIGNED_TEACHER');
    api.conforms(notYours);
    api.conforms(await request(app).post(`${SESSIONS}/${nextId}/cancel`).set(tAuth).send({ reason: 'x' })); // 403 no longer teaches the group
  });

  it('exercised every documented operation of Module 24', () => {
    expect(api.operationCount('24')).toBe(4);
    api.assertAllExercised('24');
  });
});
