import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { GROUPS, SCHEDULES, createSchedulesApi } from '../helpers/schedules-api-harness';

const UNKNOWN = '00000000-0000-4000-8000-000000000000';

async function world() {
  const api = await createSchedulesApi();
  const { app, t, login, loginInitial } = api;
  const school = await t.newSchool('مدرسة أ');
  const school2 = await t.newSchool('مدرسة ب');
  const manager = await t.newSchoolManager(school.id);
  const manager2 = await t.newSchoolManager(school2.id);
  const auth = await login(manager);
  const auth2 = await login(manager2);
  const teacher = await t.newTeacher(school.id, manager.id);
  const parent = await t.newParent(school.id, manager.id);
  const group = await t.newGroup(school.id, manager.id, { teacherId: teacher.id });
  const second = await t.newGroup(school.id, manager.id, { teacherId: teacher.id });
  const bare = await t.newGroup(school.id, manager.id);
  const student = await t.registerStudent(school.id, parent.id, manager.id);
  await t.groups.assignStudent(group.id, student.id, manager.id);
  const slots = (id: string) => `${SCHEDULES}/${id}/slots`;
  const post = (id: string, as: Record<string, string>, day: string, startTime: string, endTime: string) => request(app).post(slots(id)).set(as).send({ dayOfWeek: day, startTime, endTime });
  return { ...api, school, school2, manager, manager2, auth, auth2, teacher, parent, group, second, bare, slots, post, loginInitial };
}

describe('the schedule over HTTP', () => {
  it('lets the School Manager add slots and read them back in week order, with the actor taken from the token', async () => {
    const { app, auth, manager, group, slots, post } = await world();
    const friday = await post(group.id, auth, 'FRIDAY', '16:00', '17:00');
    expect(friday.status).toBe(201);
    expect(friday.body.data).toMatchObject({ groupId: group.id, dayOfWeek: 'FRIDAY', startTime: '16:00', endTime: '17:00', status: 'ACTIVE', createdBy: manager.id, retiredAt: null, retireReason: null });
    // client-supplied identity or ownership fields are ignored: the actor and the group come from the token and the path
    const sat = await request(app).post(slots(group.id)).set(auth).send({ dayOfWeek: 'SATURDAY', startTime: '09:00', endTime: '10:00', createdBy: UNKNOWN, groupId: UNKNOWN, schoolId: UNKNOWN, status: 'RETIRED' });
    expect(sat.status).toBe(201);
    expect(sat.body.data).toMatchObject({ groupId: group.id, createdBy: manager.id, status: 'ACTIVE' });
    await post(group.id, auth, 'MONDAY', '18:00', '19:00');
    const list = await request(app).get(slots(group.id)).set(auth);
    expect(list.status).toBe(200);
    expect(list.body.data.map((s: { dayOfWeek: string }) => s.dayOfWeek)).toEqual(['SATURDAY', 'MONDAY', 'FRIDAY']);
  });

  it('refuses a second slot on the same weekday whether the times overlap, touch or are completely separate, with or without a Teacher (409), in Arabic and in English', async () => {
    const { app, auth, group, bare, slots, post } = await world();
    for (const g of [group, bare]) {
      expect((await post(g.id, auth, 'TUESDAY', '18:00', '19:00')).status).toBe(201);
      for (const [start, end] of [['18:30', '19:30'], ['19:00', '20:00'], ['17:00', '18:00'], ['08:00', '09:00'], ['18:00', '19:00']] as const) {
        const res = await post(g.id, auth, 'TUESDAY', start, end);
        expect(res.status, `${start}-${end}`).toBe(409);
        expect(res.body.error.code).toBe('SCHEDULE_DAY_ALREADY_HAS_SLOT');
        expect(res.body.error.details).toMatchObject({ dayOfWeek: 'TUESDAY' });
      }
      expect((await request(app).get(slots(g.id)).set(auth)).body.data).toHaveLength(1);
      expect((await post(g.id, auth, 'WEDNESDAY', '18:00', '19:00')).status).toBe(201); // another weekday is fine
    }
    const english = await request(app).post(slots(group.id)).set(auth).set('Accept-Language', 'en').send({ dayOfWeek: 'TUESDAY', startTime: '10:00', endTime: '11:00' });
    expect(english.body.error.message).toBe('A group can have only one slot per weekday; this group already has a slot on that day.');
    const arabic = await request(app).post(slots(group.id)).set(auth).set('Accept-Language', 'ar').send({ dayOfWeek: 'TUESDAY', startTime: '10:00', endTime: '11:00' });
    expect(arabic.body.error.message).toMatch(/موعد واحد فقط/);
  });

  it('also refuses to CHANGE a slot onto a weekday that already has one, even with no time overlap', async () => {
    const { app, auth, group, slots, post } = await world();
    const monday = (await post(group.id, auth, 'MONDAY', '08:00', '09:00')).body.data;
    await post(group.id, auth, 'TUESDAY', '17:00', '18:00');
    const res = await request(app).patch(`${slots(group.id)}/${monday.id}`).set(auth).send({ dayOfWeek: 'TUESDAY' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SCHEDULE_DAY_ALREADY_HAS_SLOT');
    expect((await request(app).get(slots(group.id)).set(auth)).body.data.map((s: { id: string }) => s.id)).toContain(monday.id);
  });

  it('refuses a Teacher overlap across the Teacher\'s groups (409) but allows touching boundaries', async () => {
    const { auth, group, second, post } = await world();
    await post(group.id, auth, 'MONDAY', '18:00', '19:00');
    const clash = await post(second.id, auth, 'MONDAY', '18:30', '19:30');
    expect(clash.status).toBe(409);
    expect(clash.body.error.code).toBe('TEACHER_SCHEDULE_CONFLICT');
    expect(clash.body.error.details.conflicts).toEqual([{ dayOfWeek: 'MONDAY', startTime: '18:00', endTime: '19:00', group: { id: group.id, name: group.name } }]);
    expect((await post(second.id, auth, 'MONDAY', '19:00', '20:00')).status).toBe(201);
  });

  it('validates a new Teacher against the group\'s slots when the Teacher is assigned (PUT /groups/:id/teacher)', async () => {
    const { app, t, auth, teacher, group, bare, post } = await world();
    await post(group.id, auth, 'MONDAY', '18:00', '19:00'); // the Teacher is busy Monday 18:00-19:00
    await post(bare.id, auth, 'MONDAY', '18:30', '19:30'); // a group without a Teacher: allowed
    const refused = await request(app).put(`${GROUPS}/${bare.id}/teacher`).set(auth).send({ teacherId: teacher.id });
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('TEACHER_SCHEDULE_CONFLICT');
    expect((await t.groups.getGroup(bare.id)).teacher).toBeNull(); // nothing changed
    // removing the slot makes the assignment possible
    const slot = (await t.schedules.listSlots(bare.id))[0]!;
    expect((await request(app).delete(`${SCHEDULES}/${bare.id}/slots/${slot.id}`).set(auth)).status).toBe(204);
    expect((await request(app).put(`${GROUPS}/${bare.id}/teacher`).set(auth).send({ teacherId: teacher.id })).status).toBe(200);
  });

  it('replaces a slot atomically on PATCH (a new id, the old one retired) and keeps it as history on DELETE (204, never physically deleted)', async () => {
    const { app, auth, manager, group, slots, post } = await world();
    const old = (await post(group.id, auth, 'MONDAY', '18:00', '19:00')).body.data;
    const patched = await request(app).patch(`${slots(group.id)}/${old.id}`).set(auth).send({ startTime: '18:30', endTime: '19:30' });
    expect(patched.status).toBe(200);
    expect(patched.body.data).toMatchObject({ dayOfWeek: 'MONDAY', startTime: '18:30', endTime: '19:30', status: 'ACTIVE' });
    expect(patched.body.data.id).not.toBe(old.id);
    expect((await request(app).delete(`${slots(group.id)}/${patched.body.data.id}`).set(auth)).status).toBe(204);
    const history = (await request(app).get(`${slots(group.id)}/history`).set(auth)).body.data;
    expect(history.map((s: { id: string; status: string; retireReason: string | null }) => [s.id, s.status, s.retireReason])).toEqual([
      [old.id, 'RETIRED', 'REPLACED'],
      [patched.body.data.id, 'RETIRED', 'REMOVED'],
    ]);
    expect(history[0]).toMatchObject({ replacedBySlotId: patched.body.data.id, retiredBy: manager.id });
    expect((await request(app).get(slots(group.id)).set(auth)).body.data).toEqual([]);
  });

  it('retires the slots when the group is archived (history kept) and makes the schedule read-only (422)', async () => {
    const { app, auth, group, slots, post } = await world();
    const s = (await post(group.id, auth, 'MONDAY', '18:00', '19:00')).body.data;
    expect((await request(app).post(`${GROUPS}/${group.id}/archive`).set(auth).send({ reason: 'انتهت' })).status).toBe(200);
    const history = (await request(app).get(`${slots(group.id)}/history`).set(auth)).body.data;
    expect(history).toEqual([expect.objectContaining({ id: s.id, status: 'RETIRED', retireReason: 'GROUP_ARCHIVED' })]);
    expect((await post(group.id, auth, 'TUESDAY', '18:00', '19:00')).body.error.code).toBe('GROUP_ARCHIVED');
    expect((await request(app).patch(`${slots(group.id)}/${s.id}`).set(auth).send({ startTime: '17:00' })).body.error.code).toBe('GROUP_ARCHIVED');
  });

  it('shows the schedule to the Teacher and the Parent of the group only, history only to the manager, and the Teacher\'s own weekly schedule', async () => {
    const { app, t, auth, auth2, teacher, parent, group, second, school2, manager2, slots, post, loginInitial } = await world();
    await post(group.id, auth, 'MONDAY', '18:00', '19:00');
    const tAuth = await loginInitial((await t.h.identity.findById(teacher.userId))!.phone);
    const pAuth = await loginInitial((await t.h.identity.findById(parent.userId))!.phone);
    for (const who of [auth, tAuth, pAuth]) expect((await request(app).get(slots(group.id)).set(who)).status).toBe(200);
    expect((await request(app).get(slots(group.id)).set(auth2)).status).toBe(403);
    expect((await request(app).get(slots(second.id)).set(pAuth)).status).toBe(403); // not their child's group
    expect((await request(app).get(`${slots(group.id)}/history`).set(tAuth)).status).toBe(403);
    expect((await request(app).get(`${slots(group.id)}/history`).set(pAuth)).status).toBe(403);
    expect((await request(app).post(slots(group.id)).set(tAuth).send({ dayOfWeek: 'FRIDAY', startTime: '10:00', endTime: '11:00' })).status).toBe(403);
    expect((await request(app).post(slots(group.id)).set(pAuth).send({ dayOfWeek: 'FRIDAY', startTime: '10:00', endTime: '11:00' })).status).toBe(403);
    expect((await request(app).get(slots(group.id))).status).toBe(401);
    // own weekly schedule, across schools
    await t.linkTeacher(teacher.id, school2.id, manager2.id);
    const abroad = await t.newGroup(school2.id, manager2.id, { teacherId: teacher.id });
    await t.schedules.addSlot(abroad.id, { dayOfWeek: 'SATURDAY', startTime: '09:00', endTime: '10:00' }, manager2.id);
    const own = await request(app).get(`${SCHEDULES}/mine`).set(tAuth);
    expect(own.status).toBe(200);
    expect(own.body.data.map((i: { dayOfWeek: string; groupId: string }) => `${i.dayOfWeek} ${i.groupId}`)).toEqual([`SATURDAY ${abroad.id}`, `MONDAY ${group.id}`]);
    expect((await request(app).get(`${SCHEDULES}/mine`).set(auth)).status).toBe(403);
  });

  it('rejects malformed requests with 400 before anything is stored', async () => {
    const { app, auth, group, slots } = await world();
    for (const bad of [{}, { dayOfWeek: 1, startTime: '18:00', endTime: '19:00' }, { dayOfWeek: 'MONDAY', startTime: 1800, endTime: '19:00' }, { dayOfWeek: 'MONDAY', startTime: '18:00' }]) {
      expect((await request(app).post(slots(group.id)).set(auth).send(bad)).status, JSON.stringify(bad)).toBe(400);
    }
    expect((await request(app).post(slots(group.id)).set(auth).send({ dayOfWeek: 'MONDAY', startTime: '25:00', endTime: '26:00' })).body.error.code).toBe('SCHEDULE_TIME_INVALID');
    expect((await request(app).post(slots(group.id)).set(auth).send({ dayOfWeek: 'MONDAY', startTime: '19:00', endTime: '18:00' })).body.error.code).toBe('SCHEDULE_TIME_RANGE_INVALID');
    expect((await request(app).get(slots(group.id)).set(auth)).body.data).toEqual([]);
  });
});
