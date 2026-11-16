import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { GROUPS, SCHEDULES, createSchedulesApi } from '../../helpers/schedules-api-harness';
import { ApiConformance } from '../support/conformance';

const UNKNOWN = '00000000-0000-4000-8000-000000000000';

describe('Module 23 endpoints conform to their OpenAPI documentation (real responses)', () => {
  let api: ApiConformance;
  beforeAll(async () => {
    api = await ApiConformance.create();
  });

  it('schedule: add, list, history, change, remove and own schedule, with their error responses', async () => {
    const { app, t, login, loginInitial } = await createSchedulesApi();
    const school = await t.newSchool('مدرسة أ');
    const school2 = await t.newSchool('مدرسة ب');
    const manager = await t.newSchoolManager(school.id);
    const manager2 = await t.newSchoolManager(school2.id);
    const auth = await login(manager);
    const auth2 = await login(manager2);
    const teacher = await t.newTeacher(school.id, manager.id);
    const parent = await t.newParent(school.id, manager.id);
    const group = await t.newGroup(school.id, manager.id, { teacherId: teacher.id });
    const other = await t.newGroup(school.id, manager.id, { teacherId: teacher.id });
    const bare = await t.newGroup(school.id, manager.id);
    const student = await t.registerStudent(school.id, parent.id, manager.id);
    await t.groups.assignStudent(group.id, student.id, manager.id);
    const slots = (id: string) => `${SCHEDULES}/${id}/slots`;
    const slot = { dayOfWeek: 'MONDAY', startTime: '18:00', endTime: '19:00' };

    // add
    const created = api.conforms(await request(app).post(slots(group.id)).set(auth).send(slot));
    expect(created.status).toBe(201);
    const slotId = created.body.data.id as string;
    api.conforms(await request(app).post(slots(group.id)).set(auth).send({})); // 400 validation
    api.conforms(await request(app).post(slots(group.id)).set(auth).send({ ...slot, dayOfWeek: 'FUNDAY' })); // 400 day
    api.conforms(await request(app).post(slots(group.id)).set(auth).send({ ...slot, startTime: '6pm' })); // 400 time
    api.conforms(await request(app).post(slots(group.id)).set(auth).send({ ...slot, dayOfWeek: 'TUESDAY', startTime: '19:00', endTime: '18:00' })); // 400 range
    api.conforms(await request(app).post(slots(group.id)).send(slot)); // 401
    api.conforms(await request(app).post(slots(group.id)).set(auth2).send(slot)); // 403 another school's manager
    api.conforms(await request(app).post(slots(UNKNOWN)).set(auth).send(slot)); // 403 unknown group
    const second = await request(app).post(slots(group.id)).set(auth).send({ dayOfWeek: 'MONDAY', startTime: '08:00', endTime: '09:00' }); // 409 one slot per weekday, no overlap
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('SCHEDULE_DAY_ALREADY_HAS_SLOT');
    api.conforms(second);
    const clash = await request(app).post(slots(other.id)).set(auth).send({ dayOfWeek: 'MONDAY', startTime: '18:30', endTime: '19:30' }); // 409 Teacher conflict
    expect(clash.body.error.code).toBe('TEACHER_SCHEDULE_CONFLICT');
    api.conforms(clash);
    expect(api.conforms(await request(app).post(slots(other.id)).set(auth).send({ dayOfWeek: 'MONDAY', startTime: '19:00', endTime: '20:00' })).status).toBe(201); // touching is fine
    expect(api.conforms(await request(app).post(slots(bare.id)).set(auth).send({ dayOfWeek: 'WEDNESDAY', startTime: '16:00', endTime: '17:00' })).status).toBe(201);

    // reads
    expect(api.conforms(await request(app).get(slots(group.id)).set(auth)).status).toBe(200);
    const tAuth = await loginInitial((await t.h.identity.findById(teacher.userId))!.phone);
    const pAuth = await loginInitial((await t.h.identity.findById(parent.userId))!.phone);
    expect(api.conforms(await request(app).get(slots(group.id)).set(tAuth)).status).toBe(200);
    expect(api.conforms(await request(app).get(slots(group.id)).set(pAuth)).status).toBe(200);
    api.conforms(await request(app).get(slots(group.id)).set(auth2)); // 403
    api.conforms(await request(app).get(slots(group.id))); // 401
    api.conforms(await request(app).get(slots('not-a-uuid')).set(auth)); // 400
    expect(api.conforms(await request(app).get(`${slots(group.id)}/history`).set(auth)).status).toBe(200);
    api.conforms(await request(app).get(`${slots(group.id)}/history`).set(tAuth)); // 403 teacher
    api.conforms(await request(app).get(`${slots(group.id)}/history`).set(pAuth)); // 403 parent
    expect(api.conforms(await request(app).get(`${SCHEDULES}/mine`).set(tAuth)).status).toBe(200);
    api.conforms(await request(app).get(`${SCHEDULES}/mine`).set(auth)); // 403 manager
    api.conforms(await request(app).get(`${SCHEDULES}/mine`)); // 401

    // change (atomic replacement)
    const changed = api.conforms(await request(app).patch(`${slots(group.id)}/${slotId}`).set(auth).send({ startTime: '17:00' }));
    expect(changed.status).toBe(200);
    expect(changed.body.data.id).not.toBe(slotId);
    const newId = changed.body.data.id as string;
    api.conforms(await request(app).patch(`${slots(group.id)}/${newId}`).set(auth).send({})); // 400 nothing to change
    api.conforms(await request(app).patch(`${slots(group.id)}/${newId}`).set(auth).send({ endTime: '16:00' })); // 400 range
    api.conforms(await request(app).patch(`${slots(group.id)}/${slotId}`).set(auth).send({ startTime: '16:00' })); // 404 retired slot
    api.conforms(await request(app).patch(`${slots(group.id)}/${newId}`).set(auth2).send({ startTime: '16:00' })); // 403
    api.conforms(await request(app).patch(`${slots(group.id)}/not-a-uuid`).set(auth).send({ startTime: '16:00' })); // 400
    api.conforms(await request(app).patch(`${slots(group.id)}/${newId}`).set(auth).send({ endTime: '19:30' })); // 409 Teacher conflict on a CHANGE (17:00-19:30 would overlap the other group's 19:00-20:00)
    api.conforms(await request(app).post(slots(group.id)).set(auth).send({ dayOfWeek: 'FRIDAY', startTime: '10:00', endTime: '11:00' }));
    const friday = (await t.schedules.listSlots(group.id)).find((s) => s.dayOfWeek === 'FRIDAY')!;
    api.conforms(await request(app).patch(`${slots(group.id)}/${friday.id}`).set(auth).send({ dayOfWeek: 'MONDAY' })); // 409 weekday taken

    // remove (retire)
    expect(api.conforms(await request(app).delete(`${slots(group.id)}/${friday.id}`).set(auth)).status).toBe(204);
    api.conforms(await request(app).delete(`${slots(group.id)}/${friday.id}`).set(auth)); // 404 already retired
    api.conforms(await request(app).delete(`${slots(group.id)}/${newId}`).set(auth2)); // 403
    api.conforms(await request(app).delete(`${slots(group.id)}/${newId}`)); // 401

    // an archived group's schedule is read-only
    expect(api.conforms(await request(app).post(`${GROUPS}/${bare.id}/archive`).set(auth).send({ reason: 'انتهت' })).status).toBe(200);
    api.conforms(await request(app).post(slots(bare.id)).set(auth).send({ dayOfWeek: 'SUNDAY', startTime: '10:00', endTime: '11:00' })); // 422
    api.conforms(await request(app).delete(`${slots(bare.id)}/${(await t.schedules.listHistory(bare.id))[0]!.id}`).set(auth)); // 422
  });

  it('exercised every documented operation of Module 23', () => {
    expect(api.operationCount('23')).toBe(6);
    api.assertAllExercised('23');
  });
});
