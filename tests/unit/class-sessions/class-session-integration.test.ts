import { describe, expect, it } from 'vitest';
import { createClassSessionsHarness } from '../../helpers/class-sessions-harness';

const THRESHOLD = new Date('2026-11-02T15:45:00Z'); // Monday; the 18:00 Cairo (UTC+2) slot starts at 16:00Z

/** Module 24 over the REAL Module 23 (slots) and Module 20 (groups): what generation and reconciliation see is what Module 23 holds. */
async function setup() {
  const t = await createClassSessionsHarness();
  const school = await t.newSchool('مدرسة أ');
  const manager = await t.newSchoolManager(school.id);
  const teacher = await t.newTeacher(school.id, manager.id);
  const group = await t.newGroup(school.id, manager.id, { teacherId: teacher.id });
  const slot = await t.schedules.addSlot(group.id, { dayOfWeek: 'MONDAY', startTime: '18:00', endTime: '19:00' }, manager.id);
  return { t, school, manager, teacher, group, slot };
}

describe('Module 24 over the real Module 23 and Module 20', () => {
  it('creates the session from the real slot, 15 minutes before its start, for the group\'s Teacher', async () => {
    const { t, school, teacher, group, slot } = await setup();
    t.sessionClock.set(new Date('2026-11-02T15:44:59Z'));
    expect((await t.classSessions.generateDueSessions()).created).toBe(0);
    t.sessionClock.set(THRESHOLD);
    expect((await t.classSessions.generateDueSessions()).created).toBe(1);
    const s = [...t.sessionRepo.rows.values()][0]!;
    expect(s).toMatchObject({ schoolId: school.id, groupId: group.id, teacherId: teacher.id, slotId: slot.id, status: 'OPEN', occurrenceDate: '2026-11-02' });
  });

  it('a slot removed in Module 23 before the session exists never produces one; removed after creation (before the start) cancels it with the reason', async () => {
    const a = await setup();
    await a.t.schedules.removeSlot(a.group.id, a.slot.id, a.manager.id);
    a.t.sessionClock.set(THRESHOLD);
    await a.t.classSessions.runCycle();
    expect(a.t.sessionRepo.rows.size).toBe(0);

    const b = await setup();
    b.t.sessionClock.set(THRESHOLD);
    await b.t.classSessions.generateDueSessions();
    await b.t.schedules.removeSlot(b.group.id, b.slot.id, b.manager.id);
    b.t.sessionClock.set(new Date('2026-11-02T15:50:00Z'));
    expect((await b.t.classSessions.runCycle()).cancelledForRetiredSlots).toBe(1);
    expect([...b.t.sessionRepo.rows.values()][0]).toMatchObject({ status: 'CANCELLED', cancelSource: 'SCHEDULE_SLOT_RETIRED', slotRetireReason: 'REMOVED', cancelledBy: null });
  });

  it('archiving the group retires its slots: an unstarted session is cancelled (GROUP_ARCHIVED)', async () => {
    const a = await setup();
    a.t.sessionClock.set(THRESHOLD);
    await a.t.classSessions.generateDueSessions();
    await a.t.groups.archiveGroup(a.group.id, 'انتهت', a.manager.id);
    a.t.sessionClock.set(new Date('2026-11-02T15:55:00Z'));
    await a.t.classSessions.runCycle();
    expect([...a.t.sessionRepo.rows.values()][0]).toMatchObject({ status: 'CANCELLED', slotRetireReason: 'GROUP_ARCHIVED' });
  });

  it('replacing a slot (change) cancels the old slot\'s unstarted session and the new slot gets its own session at its own threshold', async () => {
    const { t, group, slot, manager } = await setup();
    t.sessionClock.set(THRESHOLD);
    await t.classSessions.generateDueSessions();
    const changed = await t.schedules.changeSlot(group.id, slot.id, { startTime: '18:30', endTime: '19:30' }, manager.id);
    t.sessionClock.set(new Date('2026-11-02T15:50:00Z'));
    await t.classSessions.runCycle();
    let rows = [...t.sessionRepo.rows.values()];
    expect(rows.find((s) => s.slotId === slot.id)).toMatchObject({ status: 'CANCELLED', slotRetireReason: 'REPLACED' });
    expect(rows.find((s) => s.slotId === changed.id)).toBeUndefined(); // threshold of the new slot (16:15Z) not reached yet
    t.sessionClock.set(new Date('2026-11-02T16:15:00Z'));
    await t.classSessions.runCycle();
    rows = [...t.sessionRepo.rows.values()];
    expect(rows.find((s) => s.slotId === changed.id)).toMatchObject({ status: 'OPEN' });
  });
});
