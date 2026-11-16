import { describe, expect, it } from 'vitest';
import { AppError } from '../../../src/modules/00-shared-kernel/public';
import { DAYS_OF_WEEK } from '../../../src/modules/23-group-schedules/public';
import { createSchedulesHarness } from '../../helpers/schedules-harness';

const UNKNOWN = '00000000-0000-4000-8000-000000000000';
const codeOf = (p: Promise<unknown>) => p.then(() => 'NO_ERROR', (e: unknown) => (e instanceof AppError ? e.code : `NOT_APP_ERROR:${String(e)}`));
async function failure(p: Promise<unknown>): Promise<AppError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof AppError) return e;
    throw e;
  }
  throw new Error('expected a rejection');
}

async function setup() {
  const t = await createSchedulesHarness();
  const school = await t.newSchool('مدرسة أ');
  const manager = await t.newSchoolManager(school.id);
  const teacher = await t.newTeacher(school.id, manager.id);
  const group = await t.newGroup(school.id, manager.id, { teacherId: teacher.id });
  const noTeacher = await t.newGroup(school.id, manager.id);
  const slot = (day: string, startTime: string, endTime: string) => ({ dayOfWeek: day, startTime, endTime });
  const add = (groupId: string, day: string, start: string, end: string) => t.schedules.addSlot(groupId, slot(day, start, end), manager.id);
  const active = async (groupId: string) => (await t.schedules.listSlots(groupId)).map((s) => `${s.dayOfWeek} ${s.startTime}-${s.endTime}`);
  const events = (type?: string) => t.h.store.messages.filter((m) => m.aggregateType === 'GroupScheduleSlot' && (!type || m.eventType === type));
  return { t, school, manager, teacher, group, noTeacher, slot, add, active, events };
}

describe('adding a slot', () => {
  it('creates an ACTIVE slot (day, start, end), lists it and publishes one GroupScheduleSlotCreated event of identifiers only', async () => {
    const { t, group, manager, add, active, events } = await setup();
    const s = await add(group.id, 'SUNDAY', '18:00', '19:00');
    expect(s).toMatchObject({ groupId: group.id, dayOfWeek: 'SUNDAY', startTime: '18:00', endTime: '19:00', status: 'ACTIVE', createdBy: manager.id, retiredAt: null, retireReason: null, replacedBySlotId: null });
    expect(s.id).toBeTruthy();
    expect(await active(group.id)).toEqual(['SUNDAY 18:00-19:00']);
    const created = events('GroupScheduleSlotCreated');
    expect(created).toHaveLength(1);
    expect(JSON.parse(created[0]!.payload)).toMatchObject({ groupId: group.id, slotId: s.id, dayOfWeek: 'SUNDAY', startTime: '18:00', endTime: '19:00', actorId: manager.id });
    expect(created[0]!.payload).not.toMatch(/حلقة/);
    expect(t.slotRepo.slots.size).toBe(1);
  });

  it('allows slots on several DIFFERENT weekdays and lists them in week order (Saturday first), then by start time', async () => {
    const { group, add, active } = await setup();
    for (const d of ['FRIDAY', 'MONDAY', 'SATURDAY', 'THURSDAY', 'SUNDAY', 'WEDNESDAY', 'TUESDAY']) await add(group.id, d, '16:00', '17:00');
    expect(await active(group.id)).toEqual(DAYS_OF_WEEK.map((d) => `${d} 16:00-17:00`));
  });

  it('validates the day and the times and creates nothing on failure', async () => {
    const { t, group, add, events } = await setup();
    expect(await codeOf(add(group.id, 'FUNDAY', '18:00', '19:00'))).toBe('SCHEDULE_DAY_INVALID');
    expect(await codeOf(add(group.id, 'monday', '18:00', '19:00'))).toBe('SCHEDULE_DAY_INVALID');
    expect(await codeOf(add(group.id, 'MONDAY', '6pm', '19:00'))).toBe('SCHEDULE_TIME_INVALID');
    expect(await codeOf(add(group.id, 'MONDAY', '18:00', '24:00'))).toBe('SCHEDULE_TIME_INVALID');
    expect(await codeOf(add(group.id, 'MONDAY', '19:00', '18:00'))).toBe('SCHEDULE_TIME_RANGE_INVALID');
    expect(await codeOf(add(group.id, 'MONDAY', '18:00', '18:00'))).toBe('SCHEDULE_TIME_RANGE_INVALID');
    expect(t.slotRepo.slots.size).toBe(0);
    expect(events()).toHaveLength(0);
  });

  it('needs an existing, ACTIVE group (an ARCHIVED group is read-only and final)', async () => {
    const { t, manager, noTeacher, add } = await setup();
    expect(await codeOf(add(UNKNOWN, 'MONDAY', '18:00', '19:00'))).toBe('GROUP_NOT_FOUND');
    await t.groups.archiveGroup(noTeacher.id, 'إغلاق الحلقة', manager.id);
    expect(await codeOf(add(noTeacher.id, 'MONDAY', '18:00', '19:00'))).toBe('GROUP_ARCHIVED');
  });
});

describe('ONE slot per weekday for a group (a rule of the group itself, with or without a Teacher)', () => {
  const second: Array<[string, string, string, string, string]> = [
    ['overlaps the first', '18:00', '19:00', '18:30', '19:30'],
    ['only TOUCHES the first (19:00 is where the first ends)', '18:00', '19:00', '19:00', '20:00'],
    ['touches the first from before (ends at 18:00)', '18:00', '19:00', '17:00', '18:00'],
    ['is completely SEPARATE from the first (morning and evening)', '08:00', '09:00', '17:00', '18:00'],
    ['is inside the first', '16:00', '20:00', '17:00', '18:00'],
    ['is identical to the first', '18:00', '19:00', '18:00', '19:00'],
  ];

  describe.each([['a group WITH a Teacher', 'group'], ['a group WITHOUT a Teacher', 'noTeacher']] as const)('%s', (_name, which) => {
    it.each(second)('rejects a second slot on the same weekday that %s', async (_why, firstStart, firstEnd, secondStart, secondEnd) => {
      const ctx = await setup();
      const g = ctx[which];
      const first = await ctx.add(g.id, 'TUESDAY', firstStart, firstEnd);
      const error = await failure(ctx.add(g.id, 'TUESDAY', secondStart, secondEnd));
      expect(error.code).toBe('SCHEDULE_DAY_ALREADY_HAS_SLOT');
      expect(error.kind).toBe('CONFLICT');
      expect(error.details).toMatchObject({ dayOfWeek: 'TUESDAY' });
      // nothing changed: still exactly the first slot, no second row, no second event
      expect(await ctx.active(g.id)).toEqual([`TUESDAY ${firstStart}-${firstEnd}`]);
      expect((await ctx.t.schedules.listSlots(g.id))[0]!.id).toBe(first.id);
      expect(ctx.t.slotRepo.slots.size).toBe(1);
      expect(ctx.events('GroupScheduleSlotCreated')).toHaveLength(1);
    });
  });

  it('is checked for every weekday, and different weekdays stay allowed (even the same times)', async () => {
    const { group, add, active } = await setup();
    for (const d of DAYS_OF_WEEK) await add(group.id, d, '18:00', '19:00');
    for (const d of DAYS_OF_WEEK) expect(await codeOf(add(group.id, d, '10:00', '11:00')), d).toBe('SCHEDULE_DAY_ALREADY_HAS_SLOT');
    expect(await active(group.id)).toHaveLength(7);
  });

  it('is a rule of ONE group: another group may use the same weekday and times when no Teacher is shared', async () => {
    const { group, noTeacher, add, active } = await setup();
    await add(group.id, 'MONDAY', '18:00', '19:00');
    await add(noTeacher.id, 'MONDAY', '18:00', '19:00'); // a different group, no Teacher: no conflict
    expect(await active(noTeacher.id)).toEqual(['MONDAY 18:00-19:00']);
  });

  it('frees the weekday once the slot is retired: removed, or replaced', async () => {
    const { t, manager, group, add, active } = await setup();
    const s = await add(group.id, 'MONDAY', '18:00', '19:00');
    await t.schedules.removeSlot(group.id, s.id, manager.id);
    const again = await add(group.id, 'MONDAY', '20:00', '21:00');
    expect(await active(group.id)).toEqual(['MONDAY 20:00-21:00']);
    await t.schedules.changeSlot(group.id, again.id, { startTime: '20:30' }, manager.id);
    expect(await codeOf(add(group.id, 'MONDAY', '08:00', '09:00'))).toBe('SCHEDULE_DAY_ALREADY_HAS_SLOT');
  });

  it('also applies when a slot is CHANGED to another weekday that already has a slot, even with no time overlap', async () => {
    const { group, manager, t, add, active } = await setup();
    const monday = await add(group.id, 'MONDAY', '08:00', '09:00');
    await add(group.id, 'TUESDAY', '17:00', '18:00');
    const error = await failure(t.schedules.changeSlot(group.id, monday.id, { dayOfWeek: 'TUESDAY' }, manager.id));
    expect(error.code).toBe('SCHEDULE_DAY_ALREADY_HAS_SLOT');
    expect(await codeOf(t.schedules.changeSlot(group.id, monday.id, { dayOfWeek: 'TUESDAY', startTime: '10:00', endTime: '11:00' }, manager.id))).toBe('SCHEDULE_DAY_ALREADY_HAS_SLOT');
    expect(await active(group.id)).toEqual(['MONDAY 08:00-09:00', 'TUESDAY 17:00-18:00']);
    expect(t.slotRepo.slots.size).toBe(2); // the failed change created and retired nothing
  });
});

describe('changing a slot (atomic replacement: the old slot is retired, a new one created, in ONE transaction)', () => {
  it('retires the old slot as REPLACED (pointing at its replacement), creates the new one and keeps both in the history', async () => {
    const { t, group, manager, add, active, events } = await setup();
    const old = await add(group.id, 'MONDAY', '18:00', '19:00');
    const changed = await t.schedules.changeSlot(group.id, old.id, { startTime: '18:30', endTime: '19:30' }, manager.id);
    expect(changed).toMatchObject({ groupId: group.id, dayOfWeek: 'MONDAY', startTime: '18:30', endTime: '19:30', status: 'ACTIVE' });
    expect(changed.id).not.toBe(old.id);
    expect(await active(group.id)).toEqual(['MONDAY 18:30-19:30']);
    const history = await t.schedules.listHistory(group.id);
    expect(history.map((s) => [s.id, s.status, s.startTime, s.retireReason, s.replacedBySlotId])).toEqual([
      [old.id, 'RETIRED', '18:00', 'REPLACED', changed.id],
      [changed.id, 'ACTIVE', '18:30', null, null],
    ]);
    expect(history[0]).toMatchObject({ retiredBy: manager.id });
    expect(history[0]!.retiredAt).toBeInstanceOf(Date);
    expect(events('GroupScheduleSlotRetired')).toHaveLength(1);
    expect(events('GroupScheduleSlotCreated')).toHaveLength(2);
    expect(JSON.parse(events('GroupScheduleSlotRetired')[0]!.payload)).toMatchObject({ slotId: old.id, reason: 'REPLACED', replacedBySlotId: changed.id });
  });

  it('can change only the day, only the start or only the end (the rest is kept)', async () => {
    const { t, group, manager, add } = await setup();
    const s = await add(group.id, 'MONDAY', '18:00', '19:00');
    const moved = await t.schedules.changeSlot(group.id, s.id, { dayOfWeek: 'THURSDAY' }, manager.id);
    expect(moved).toMatchObject({ dayOfWeek: 'THURSDAY', startTime: '18:00', endTime: '19:00' });
    const later = await t.schedules.changeSlot(group.id, moved.id, { startTime: '18:15' }, manager.id);
    expect(later).toMatchObject({ dayOfWeek: 'THURSDAY', startTime: '18:15', endTime: '19:00' });
    const longer = await t.schedules.changeSlot(group.id, later.id, { endTime: '20:00' }, manager.id);
    expect(longer).toMatchObject({ dayOfWeek: 'THURSDAY', startTime: '18:15', endTime: '20:00' });
    expect(await t.schedules.listSlots(group.id)).toHaveLength(1);
    expect(await t.schedules.listHistory(group.id)).toHaveLength(4);
  });

  it('validates the change against the MERGED slot (the new range must still end after it starts)', async () => {
    const { t, group, manager, add } = await setup();
    const s = await add(group.id, 'MONDAY', '18:00', '19:00');
    expect(await codeOf(t.schedules.changeSlot(group.id, s.id, {}, manager.id))).toBe('SCHEDULE_UPDATE_EMPTY');
    expect(await codeOf(t.schedules.changeSlot(group.id, s.id, { startTime: '19:00' }, manager.id))).toBe('SCHEDULE_TIME_RANGE_INVALID');
    expect(await codeOf(t.schedules.changeSlot(group.id, s.id, { endTime: '17:00' }, manager.id))).toBe('SCHEDULE_TIME_RANGE_INVALID');
    expect(await codeOf(t.schedules.changeSlot(group.id, s.id, { dayOfWeek: 'x' }, manager.id))).toBe('SCHEDULE_DAY_INVALID');
    expect(await codeOf(t.schedules.changeSlot(group.id, s.id, { startTime: '25:00' }, manager.id))).toBe('SCHEDULE_TIME_INVALID');
    expect(t.slotRepo.slots.size).toBe(1);
  });

  it('a change that changes nothing returns the same slot and writes nothing', async () => {
    const { t, group, manager, add, events } = await setup();
    const s = await add(group.id, 'MONDAY', '18:00', '19:00');
    const same = await t.schedules.changeSlot(group.id, s.id, { dayOfWeek: 'MONDAY', startTime: '18:00', endTime: '19:00' }, manager.id);
    expect(same.id).toBe(s.id);
    expect(t.slotRepo.slots.size).toBe(1);
    expect(events()).toHaveLength(1);
  });

  it('only changes an ACTIVE slot of THIS group', async () => {
    const { t, group, noTeacher, manager, add } = await setup();
    const s = await add(group.id, 'MONDAY', '18:00', '19:00');
    const other = await add(noTeacher.id, 'MONDAY', '18:00', '19:00');
    expect(await codeOf(t.schedules.changeSlot(group.id, UNKNOWN, { startTime: '17:00' }, manager.id))).toBe('SCHEDULE_SLOT_NOT_FOUND');
    expect(await codeOf(t.schedules.changeSlot(group.id, other.id, { startTime: '17:00' }, manager.id))).toBe('SCHEDULE_SLOT_NOT_FOUND'); // another group's slot
    await t.schedules.removeSlot(group.id, s.id, manager.id);
    expect(await codeOf(t.schedules.changeSlot(group.id, s.id, { startTime: '17:00' }, manager.id))).toBe('SCHEDULE_SLOT_NOT_FOUND'); // already retired
    expect(await codeOf(t.schedules.changeSlot(UNKNOWN, s.id, { startTime: '17:00' }, manager.id))).toBe('GROUP_NOT_FOUND');
    expect((await t.schedules.listSlots(noTeacher.id))[0]).toMatchObject({ id: other.id, startTime: '18:00' }); // the other group is untouched
  });
});

describe('removing a slot (it is retired and kept as history, never physically deleted)', () => {
  it('retires it as REMOVED, keeps the row, publishes the retirement and frees the weekday', async () => {
    const { t, group, manager, add, active, events } = await setup();
    const s = await add(group.id, 'MONDAY', '18:00', '19:00');
    await t.schedules.removeSlot(group.id, s.id, manager.id);
    expect(await active(group.id)).toEqual([]);
    expect(t.slotRepo.slots.size).toBe(1); // still stored
    const [row] = await t.schedules.listHistory(group.id);
    expect(row).toMatchObject({ id: s.id, status: 'RETIRED', dayOfWeek: 'MONDAY', startTime: '18:00', endTime: '19:00', retireReason: 'REMOVED', retiredBy: manager.id, replacedBySlotId: null });
    expect(JSON.parse(events('GroupScheduleSlotRetired')[0]!.payload)).toMatchObject({ slotId: s.id, reason: 'REMOVED', actorId: manager.id });
    await add(group.id, 'MONDAY', '20:00', '21:00');
  });

  it('refuses an unknown, an already retired or another group\'s slot', async () => {
    const { t, group, noTeacher, manager, add } = await setup();
    const s = await add(group.id, 'MONDAY', '18:00', '19:00');
    const other = await add(noTeacher.id, 'MONDAY', '18:00', '19:00');
    expect(await codeOf(t.schedules.removeSlot(group.id, UNKNOWN, manager.id))).toBe('SCHEDULE_SLOT_NOT_FOUND');
    expect(await codeOf(t.schedules.removeSlot(group.id, other.id, manager.id))).toBe('SCHEDULE_SLOT_NOT_FOUND');
    await t.schedules.removeSlot(group.id, s.id, manager.id);
    expect(await codeOf(t.schedules.removeSlot(group.id, s.id, manager.id))).toBe('SCHEDULE_SLOT_NOT_FOUND');
    expect(await codeOf(t.schedules.removeSlot(UNKNOWN, s.id, manager.id))).toBe('GROUP_NOT_FOUND');
    expect(await t.schedules.listSlots(noTeacher.id)).toHaveLength(1);
  });
});

describe('Teacher conflicts (a Teacher\'s slots must not overlap across their ACTIVE groups; touching boundaries are allowed)', () => {
  async function twoGroups() {
    const ctx = await setup();
    const second = await ctx.t.newGroup(ctx.school.id, ctx.manager.id, { teacherId: ctx.teacher.id });
    return { ...ctx, second };
  }

  it('rejects a slot that overlaps another group of the same Teacher (the specification\'s 18:00-19:00 vs 18:30-19:30)', async () => {
    const { group, second, add, active } = await twoGroups();
    await add(group.id, 'MONDAY', '18:00', '19:00');
    const error = await failure(add(second.id, 'MONDAY', '18:30', '19:30'));
    expect(error.code).toBe('TEACHER_SCHEDULE_CONFLICT');
    expect(error.kind).toBe('CONFLICT');
    expect(error.details).toMatchObject({ conflicts: [{ dayOfWeek: 'MONDAY', startTime: '18:00', endTime: '19:00', group: { id: group.id } }] });
    expect(await active(second.id)).toEqual([]);
  });

  it('rejects identical times, a slot inside another and a slot around another', async () => {
    const { group, second, add } = await twoGroups();
    await add(group.id, 'MONDAY', '18:00', '19:00');
    expect(await codeOf(add(second.id, 'MONDAY', '18:00', '19:00'))).toBe('TEACHER_SCHEDULE_CONFLICT');
    expect(await codeOf(add(second.id, 'MONDAY', '18:10', '18:50'))).toBe('TEACHER_SCHEDULE_CONFLICT');
    expect(await codeOf(add(second.id, 'MONDAY', '17:00', '20:00'))).toBe('TEACHER_SCHEDULE_CONFLICT');
    expect(await codeOf(add(second.id, 'MONDAY', '18:59', '20:00'))).toBe('TEACHER_SCHEDULE_CONFLICT');
  });

  it('allows slots that only TOUCH (18:00-19:00 and 19:00-20:00), before or after', async () => {
    const { group, second, add, active } = await twoGroups();
    await add(group.id, 'MONDAY', '18:00', '19:00');
    await add(second.id, 'MONDAY', '19:00', '20:00');
    const third = await add(second.id, 'TUESDAY', '17:00', '18:00');
    expect(third.status).toBe('ACTIVE');
    expect(await active(second.id)).toEqual(['MONDAY 19:00-20:00', 'TUESDAY 17:00-18:00']);
  });

  it('allows the same times on a different weekday', async () => {
    const { group, second, add } = await twoGroups();
    await add(group.id, 'MONDAY', '18:00', '19:00');
    expect((await add(second.id, 'TUESDAY', '18:00', '19:00')).status).toBe('ACTIVE');
  });

  it('never conflicts different Teachers, and a group without a Teacher is never in conflict', async () => {
    const { t, school, manager, group, noTeacher, add } = await setup();
    const other = await t.newTeacher(school.id, manager.id, 'سعيد حسن محمود');
    const otherGroup = await t.newGroup(school.id, manager.id, { teacherId: other.id });
    await add(group.id, 'MONDAY', '18:00', '19:00');
    await add(otherGroup.id, 'MONDAY', '18:00', '19:00');
    await add(noTeacher.id, 'MONDAY', '18:00', '19:00');
    expect((await t.schedules.listSlots(otherGroup.id))).toHaveLength(1);
  });

  it('counts a Teacher\'s groups in EVERY school: the same Teacher cannot teach two overlapping slots in two schools, and the other school\'s group is not revealed', async () => {
    const { t, teacher, group, add } = await setup();
    const school2 = await t.newSchool('مدرسة ب');
    const manager2 = await t.newSchoolManager(school2.id);
    await t.linkTeacher(teacher.id, school2.id, manager2.id);
    const abroad = await t.newGroup(school2.id, manager2.id, { teacherId: teacher.id });
    await t.schedules.addSlot(abroad.id, { dayOfWeek: 'MONDAY', startTime: '18:00', endTime: '19:00' }, manager2.id);
    const error = await failure(add(group.id, 'MONDAY', '18:30', '19:30'));
    expect(error.code).toBe('TEACHER_SCHEDULE_CONFLICT');
    expect(error.details).toEqual({ conflicts: [{ dayOfWeek: 'MONDAY', startTime: '18:00', endTime: '19:00' }] }); // time only: no group id or name of another school
    expect(JSON.stringify(error.details)).not.toContain(abroad.id);
    expect((await add(group.id, 'MONDAY', '19:00', '20:00')).status).toBe('ACTIVE'); // touching is fine across schools too
  });

  it('ignores retired slots and ARCHIVED groups: their time is free again', async () => {
    const { t, manager, group, second, add } = await twoGroups();
    const s = await add(group.id, 'MONDAY', '18:00', '19:00');
    await t.schedules.removeSlot(group.id, s.id, manager.id);
    expect((await add(second.id, 'MONDAY', '18:30', '19:30')).status).toBe('ACTIVE'); // removed slot: free
    await t.schedules.removeSlot(second.id, (await t.schedules.listSlots(second.id))[0]!.id, manager.id);
    await add(group.id, 'MONDAY', '18:00', '19:00');
    await t.groups.archiveGroup(group.id, 'إغلاق الحلقة', manager.id);
    expect((await add(second.id, 'MONDAY', '18:30', '19:30')).status).toBe('ACTIVE'); // archived group: free
  });

  it('applies to a CHANGE too, while a slot never conflicts with its own old time', async () => {
    const { t, manager, group, second, add } = await twoGroups();
    const mine = await add(group.id, 'MONDAY', '18:00', '19:00');
    const theirs = await add(second.id, 'MONDAY', '19:00', '20:00');
    const error = await failure(t.schedules.changeSlot(second.id, theirs.id, { startTime: '18:30' }, manager.id));
    expect(error.code).toBe('TEACHER_SCHEDULE_CONFLICT');
    expect(await codeOf(t.schedules.changeSlot(group.id, mine.id, { startTime: '17:30', endTime: '19:00' }, manager.id))).toBe('NO_ERROR'); // overlaps only its own old time
    expect(await codeOf(t.schedules.changeSlot(second.id, theirs.id, { dayOfWeek: 'TUESDAY' }, manager.id))).toBe('NO_ERROR');
    // the refused change left the slot active and untouched
    expect((await t.schedules.listSlots(second.id))[0]).toMatchObject({ dayOfWeek: 'TUESDAY', startTime: '19:00' });
  });

  it('a refused change is atomic: the old slot stays ACTIVE, nothing is created or retired, no event is published', async () => {
    const { t, manager, group, second, add, events } = await twoGroups();
    await add(group.id, 'MONDAY', '18:00', '19:00');
    const theirs = await add(second.id, 'TUESDAY', '18:00', '19:00');
    const rows = t.slotRepo.slots.size;
    const published = events().length;
    await failure(t.schedules.changeSlot(second.id, theirs.id, { dayOfWeek: 'MONDAY' }, manager.id));
    expect(t.slotRepo.slots.size).toBe(rows);
    expect(events()).toHaveLength(published);
    expect((await t.schedules.listSlots(second.id))[0]).toMatchObject({ id: theirs.id, dayOfWeek: 'TUESDAY' });
  });
});

describe('assigning or replacing the Teacher validates the group\'s existing slots BEFORE committing', () => {
  async function busyTeacher() {
    const ctx = await setup();
    const { t, school, manager, teacher, add } = ctx;
    const other = await t.newTeacher(school.id, manager.id, 'سعيد حسن محمود');
    const mine = await t.newGroup(school.id, manager.id, { teacherId: teacher.id });
    await add(mine.id, 'MONDAY', '18:00', '19:00');
    const target = await t.newGroup(school.id, manager.id); // no Teacher yet
    return { ...ctx, other, mine, target };
  }

  it('refuses a Teacher whose other groups overlap, and changes nothing (the group stays without a Teacher, no history, no event)', async () => {
    const { t, manager, teacher, target, add } = await busyTeacher();
    await add(target.id, 'MONDAY', '18:30', '19:30');
    const historyBefore = (await t.groups.listHistory(target.id)).length;
    const eventsBefore = t.h.store.messages.filter((m) => m.eventType === 'GroupTeacherChanged').length;
    const error = await failure(t.groups.assignTeacher(target.id, teacher.id, manager.id));
    expect(error.code).toBe('TEACHER_SCHEDULE_CONFLICT');
    expect(error.details).toMatchObject({ conflicts: [{ dayOfWeek: 'MONDAY', startTime: '18:00', endTime: '19:00' }] });
    expect((await t.groups.getGroup(target.id)).teacher).toBeNull();
    expect((await t.groups.listHistory(target.id)).length).toBe(historyBefore);
    expect(t.h.store.messages.filter((m) => m.eventType === 'GroupTeacherChanged')).toHaveLength(eventsBefore);
  });

  it('accepts a Teacher whose time only TOUCHES, or is on another weekday, and a group without any slot', async () => {
    const { t, manager, teacher, target, add } = await busyTeacher();
    await add(target.id, 'MONDAY', '19:00', '20:00'); // touches the Teacher's 18:00-19:00
    await add(target.id, 'TUESDAY', '18:00', '19:00'); // another weekday
    expect((await t.groups.assignTeacher(target.id, teacher.id, manager.id)).teacher?.id).toBe(teacher.id);
    const bare = await t.newGroup(target.schoolId, manager.id);
    expect((await t.groups.assignTeacher(bare.id, teacher.id, manager.id)).teacher?.id).toBe(teacher.id); // no slots: nothing to conflict
  });

  it('validates a REPLACEMENT against the new Teacher; the previous Teacher stays when it is refused', async () => {
    const { t, manager, teacher, other, target, add } = await busyTeacher();
    await t.groups.assignTeacher(target.id, other.id, manager.id);
    await add(target.id, 'MONDAY', '18:30', '19:30');
    expect(await codeOf(t.groups.assignTeacher(target.id, teacher.id, manager.id))).toBe('TEACHER_SCHEDULE_CONFLICT');
    expect((await t.groups.getGroup(target.id)).teacher?.id).toBe(other.id);
  });

  it('lets the SAME Teacher be assigned again (no conflict with itself)', async () => {
    const { t, manager, teacher, mine } = await busyTeacher();
    expect((await t.groups.assignTeacher(mine.id, teacher.id, manager.id)).teacher?.id).toBe(teacher.id);
  });

  it('does NOT retire or delete the slots when the Teacher is removed or replaced', async () => {
    const { t, manager, teacher, other, mine, add } = await busyTeacher();
    await add(mine.id, 'TUESDAY', '16:00', '17:00');
    await t.groups.removeTeacher(mine.id, manager.id);
    expect(await t.schedules.listSlots(mine.id)).toHaveLength(2);
    expect((await t.schedules.listHistory(mine.id)).every((s) => s.status === 'ACTIVE')).toBe(true);
    await t.groups.assignTeacher(mine.id, other.id, manager.id);
    expect(await t.schedules.listSlots(mine.id)).toHaveLength(2);
    expect((await t.groups.getGroup(mine.id)).teacher?.id).toBe(other.id);
    expect(teacher.id).not.toBe(other.id);
  });

  it('while the group has no Teacher its slots are only bound by the one-slot-per-weekday rule, and the Teacher check happens when one is assigned later', async () => {
    const { t, manager, teacher, target, add } = await busyTeacher();
    await add(target.id, 'MONDAY', '18:00', '19:00'); // the same time as the busy Teacher's group: fine while there is no Teacher
    expect(await codeOf(t.groups.assignTeacher(target.id, teacher.id, manager.id))).toBe('TEACHER_SCHEDULE_CONFLICT');
  });
});

describe('the slots follow the group\'s Teacher (they are never retired by a Teacher change)', () => {
  it('after the Teacher is REMOVED from a group, that group\'s slots no longer count for the former Teacher; assigning the Teacher back is validated again', async () => {
    const { t, manager, teacher, group, add } = await setup();
    const second = await t.newGroup(group.schoolId, manager.id, { teacherId: teacher.id });
    await add(group.id, 'MONDAY', '18:00', '19:00');
    expect(await codeOf(add(second.id, 'MONDAY', '18:30', '19:30'))).toBe('TEACHER_SCHEDULE_CONFLICT');
    await t.groups.removeTeacher(group.id, manager.id);
    expect((await t.schedules.listSlots(group.id))).toHaveLength(1); // the slot stays
    expect((await add(second.id, 'MONDAY', '18:30', '19:30')).status).toBe('ACTIVE'); // the former Teacher is free at that time in the other group
    expect(await codeOf(t.groups.assignTeacher(group.id, teacher.id, manager.id))).toBe('TEACHER_SCHEDULE_CONFLICT'); // and the Teacher cannot simply come back
  });

  it('after the Teacher is REPLACED, the slots count for the NEW Teacher and no longer for the old one', async () => {
    const { t, school, manager, teacher, group, add } = await setup();
    const other = await t.newTeacher(school.id, manager.id, 'سعيد حسن محمود');
    const second = await t.newGroup(group.schoolId, manager.id, { teacherId: teacher.id });
    const theirs = await t.newGroup(group.schoolId, manager.id, { teacherId: other.id });
    await add(group.id, 'MONDAY', '18:00', '19:00');
    await add(theirs.id, 'TUESDAY', '18:00', '19:00');
    await t.groups.assignTeacher(group.id, other.id, manager.id); // the group (Monday 18:00) now belongs to the other Teacher
    expect((await add(second.id, 'MONDAY', '18:30', '19:30')).status).toBe('ACTIVE'); // the old Teacher is free
    expect(await codeOf(add(theirs.id, 'MONDAY', '18:30', '19:30'))).toBe('TEACHER_SCHEDULE_CONFLICT'); // the new Teacher is busy
  });
});

describe('archiving a group retires its slots (history kept)', () => {
  it('retires every ACTIVE slot with reason GROUP_ARCHIVED in the same transaction, frees the Teacher\'s time and keeps the rows', async () => {
    const { t, manager, group, add, events } = await setup();
    await add(group.id, 'MONDAY', '18:00', '19:00');
    await add(group.id, 'WEDNESDAY', '18:00', '19:00');
    await t.groups.archiveGroup(group.id, 'إغلاق الحلقة', manager.id);
    expect(await t.schedules.listSlots(group.id)).toEqual([]);
    const history = await t.schedules.listHistory(group.id);
    expect(history).toHaveLength(2);
    expect(history.every((s) => s.status === 'RETIRED' && s.retireReason === 'GROUP_ARCHIVED' && s.retiredBy === manager.id && s.replacedBySlotId === null)).toBe(true);
    expect(events('GroupScheduleSlotRetired')).toHaveLength(2);
    expect(t.slotRepo.slots.size).toBe(2);
  });

  it('makes the group\'s schedule read-only: add, change and remove answer GROUP_ARCHIVED', async () => {
    const { t, manager, noTeacher, add } = await setup();
    const s = await add(noTeacher.id, 'MONDAY', '18:00', '19:00');
    await t.groups.archiveGroup(noTeacher.id, 'إغلاق الحلقة', manager.id);
    expect(await codeOf(add(noTeacher.id, 'TUESDAY', '18:00', '19:00'))).toBe('GROUP_ARCHIVED');
    expect(await codeOf(t.schedules.changeSlot(noTeacher.id, s.id, { startTime: '17:00' }, manager.id))).toBe('GROUP_ARCHIVED');
    expect(await codeOf(t.schedules.removeSlot(noTeacher.id, s.id, manager.id))).toBe('GROUP_ARCHIVED');
    expect(await t.schedules.listHistory(noTeacher.id)).toHaveLength(1); // the history can still be read
  });

  it('archiving a group without a schedule works as before', async () => {
    const { t, manager, noTeacher } = await setup();
    expect((await t.groups.archiveGroup(noTeacher.id, 'إغلاق الحلقة', manager.id)).status).toBe('ARCHIVED');
  });
});

describe('reading', () => {
  it('lists the history oldest first, including retired slots', async () => {
    const { t, manager, group, add } = await setup();
    const a = await add(group.id, 'MONDAY', '18:00', '19:00');
    const b = await add(group.id, 'TUESDAY', '18:00', '19:00');
    await t.schedules.removeSlot(group.id, a.id, manager.id);
    expect((await t.schedules.listHistory(group.id)).map((s) => s.id)).toEqual([a.id, b.id]);
    expect(await codeOf(t.schedules.listHistory(UNKNOWN))).toBe('GROUP_NOT_FOUND');
    expect(await codeOf(t.schedules.listSlots(UNKNOWN))).toBe('GROUP_NOT_FOUND');
  });

  it('shows a Teacher their own weekly schedule across schools: only ACTIVE groups and active slots, Saturday first', async () => {
    const { t, school, manager, teacher, group, add } = await setup();
    const school2 = await t.newSchool('مدرسة ب');
    const manager2 = await t.newSchoolManager(school2.id);
    await t.linkTeacher(teacher.id, school2.id, manager2.id);
    const second = await t.newGroup(school2.id, manager2.id, { teacherId: teacher.id });
    const closed = await t.newGroup(school.id, manager.id, { teacherId: teacher.id });
    await add(group.id, 'MONDAY', '18:00', '19:00');
    await t.schedules.addSlot(second.id, { dayOfWeek: 'SATURDAY', startTime: '09:00', endTime: '10:00' }, manager2.id);
    await add(closed.id, 'SUNDAY', '08:00', '09:00');
    await t.groups.archiveGroup(closed.id, 'إغلاق الحلقة', manager.id);
    const teacherAccount = await t.teachers.getTeacher(teacher.id);
    const own = await t.schedules.listOwnSchedule(teacherAccount.userId);
    expect(own.map((i) => `${i.dayOfWeek} ${i.startTime}-${i.endTime} ${i.groupId}`)).toEqual([`SATURDAY 09:00-10:00 ${second.id}`, `MONDAY 18:00-19:00 ${group.id}`]);
    expect(own[0]).toMatchObject({ groupName: second.name, schoolId: school2.id });
  });

  it('shows nothing to an account that is not a Teacher, or to a Teacher without groups', async () => {
    const { t, school, manager } = await setup();
    const lonely = await t.newTeacher(school.id, manager.id, 'سعيد حسن محمود');
    expect(await t.schedules.listOwnSchedule((await t.teachers.getTeacher(lonely.id)).userId)).toEqual([]);
    expect(await t.schedules.listOwnSchedule(UNKNOWN)).toEqual([]);
  });
});
