import { describe, expect, it } from 'vitest';
import type { DomainEvent } from '../../../src/modules/00-shared-kernel/public';
import { NOW0, OTHER_TEACHER, TEACHER, createSessionFakes, fakeSlot } from '../../helpers/sessions-fakes';

// 2026-11-02 is a Monday; Cairo is UTC+2 then, so the slot Monday 18:00-19:00 runs 16:00Z-17:00Z and its 15-minute threshold is 15:45Z.
const THRESHOLD = new Date('2026-11-02T15:45:00Z');
const START = new Date('2026-11-02T16:00:00Z');
const END = new Date('2026-11-02T17:00:00Z');
const at = (iso: string) => new Date(iso);

async function openSession(t: ReturnType<typeof createSessionFakes>) {
  t.clock.set(THRESHOLD);
  await t.service.generateDueSessions();
  return t.all()[0]!;
}

describe('session generation: 15 minutes before the scheduled start', () => {
  it('creates nothing before the threshold and nothing days ahead', async () => {
    const t = createSessionFakes();
    t.clock.set(at('2026-11-02T15:44:59Z'));
    expect(await t.service.generateDueSessions()).toEqual({ created: 0, failed: 0 });
    t.clock.set(at('2026-11-01T15:45:00Z')); // the day before
    await t.service.generateDueSessions();
    t.clock.set(at('2026-10-27T15:45:00Z')); // a week before (a Tuesday: no occurrence)
    await t.service.generateDueSessions();
    expect(t.all()).toHaveLength(0);
  });

  it('creates the session exactly when the threshold is reached, OPEN, with times derived from the slot', async () => {
    const t = createSessionFakes();
    t.clock.set(THRESHOLD);
    expect(await t.service.generateDueSessions()).toEqual({ created: 1, failed: 0 });
    const s = t.all()[0]!;
    expect(s).toMatchObject({ schoolId: 'school-1', groupId: 'group-1', teacherId: TEACHER.teacherId, slotId: 'slot-1', occurrenceDate: '2026-11-02', status: 'OPEN', startedAt: null, completedAt: null, cancelledAt: null });
    expect(s.scheduledStart).toEqual(START);
    expect(s.scheduledEnd).toEqual(END);
    expect(t.types()).toEqual(['ClassSessionCreated']);
  });

  it('is idempotent: running again creates no second session for the same occurrence', async () => {
    const t = createSessionFakes();
    t.clock.set(THRESHOLD);
    await t.service.generateDueSessions();
    t.clock.set(at('2026-11-02T15:50:00Z'));
    expect(await t.service.generateDueSessions()).toEqual({ created: 0, failed: 0 });
    expect(t.all()).toHaveLength(1);
    expect(t.types()).toEqual(['ClassSessionCreated']);
  });

  it('gives every occurrence its own session (not only the next one per group)', async () => {
    const t = createSessionFakes([fakeSlot(), fakeSlot({ id: 'slot-2', dayOfWeek: 'TUESDAY' })]);
    t.clock.set(THRESHOLD);
    await t.service.generateDueSessions();
    t.clock.set(at('2026-11-03T15:45:00Z')); // Tuesday
    await t.service.generateDueSessions();
    t.clock.set(at('2026-11-09T15:45:00Z')); // next Monday
    await t.service.generateDueSessions();
    expect(t.all().map((s) => `${s.slotId}@${s.occurrenceDate}`).sort()).toEqual(['slot-1@2026-11-02', 'slot-1@2026-11-09', 'slot-2@2026-11-03']);
  });

  it('creates no session for a group without a Teacher', async () => {
    const t = createSessionFakes([fakeSlot({ teacherId: null })]);
    t.clock.set(THRESHOLD);
    expect(await t.service.generateDueSessions()).toEqual({ created: 0, failed: 0 });
  });

  it('never back-fills an occurrence that already ended, and creates none for a slot that did not exist at its threshold', async () => {
    const t = createSessionFakes();
    t.clock.set(END);
    await t.service.generateDueSessions();
    expect(t.all()).toHaveLength(0);
    const late = createSessionFakes([fakeSlot({ createdAt: at('2026-11-02T15:50:00Z') })]);
    late.clock.set(at('2026-11-02T16:10:00Z'));
    await late.service.generateDueSessions();
    expect(late.all()).toHaveLength(0);
  });

  it('after downtime, an occurrence that is still running (slot existed at its threshold) is created and then advanced', async () => {
    const t = createSessionFakes();
    t.clock.set(at('2026-11-02T16:30:00Z'));
    const r = await t.service.runCycle();
    expect(r).toMatchObject({ created: 1, started: 1, completed: 0, failed: 0 });
    expect(t.all()[0]!.status).toBe('IN_PROGRESS');
  });

  it('a retired slot produces no session (before creation)', async () => {
    const t = createSessionFakes([fakeSlot({ retiredAt: at('2026-11-02T10:00:00Z'), retireReason: 'REMOVED' })]);
    t.clock.set(THRESHOLD);
    await t.service.runCycle();
    expect(t.all()).toHaveLength(0);
  });

  it('follows daylight saving time (Cairo is UTC+3 in summer)', async () => {
    const t = createSessionFakes([fakeSlot({ createdAt: new Date('2026-01-01T00:00:00Z') })]);
    t.clock.set(at('2026-07-06T14:45:00Z')); // Monday 2026-07-06, 17:45 Cairo (+3) = threshold of the 18:00 session
    await t.service.generateDueSessions();
    expect(t.all()[0]!.scheduledStart).toEqual(at('2026-07-06T15:00:00Z'));
  });
});

describe('automatic lifecycle', () => {
  it('OPEN -> IN_PROGRESS at the start, IN_PROGRESS -> COMPLETED at the end, with their events', async () => {
    const t = createSessionFakes();
    await openSession(t);
    t.clock.set(at('2026-11-02T15:59:59Z'));
    expect(await t.service.advanceDueSessions()).toEqual({ started: 0, completed: 0, failed: 0 });
    t.clock.set(START);
    expect(await t.service.advanceDueSessions()).toEqual({ started: 1, completed: 0, failed: 0 });
    expect(t.all()[0]).toMatchObject({ status: 'IN_PROGRESS', startedAt: START, completedAt: null });
    t.clock.set(at('2026-11-02T16:59:59Z'));
    expect(await t.service.advanceDueSessions()).toEqual({ started: 0, completed: 0, failed: 0 });
    t.clock.set(END);
    expect(await t.service.advanceDueSessions()).toEqual({ started: 0, completed: 1, failed: 0 });
    expect(t.all()[0]).toMatchObject({ status: 'COMPLETED', completedAt: END });
    expect(t.types()).toEqual(['ClassSessionCreated', 'ClassSessionStarted', 'ClassSessionCompleted']);
    expect(await t.service.advanceDueSessions()).toEqual({ started: 0, completed: 0, failed: 0 });
  });

  it('a session whose start and end both passed (downtime) still goes through IN_PROGRESS', async () => {
    const t = createSessionFakes();
    await openSession(t);
    t.clock.set(at('2026-11-02T17:30:00Z'));
    expect(await t.service.advanceDueSessions()).toEqual({ started: 1, completed: 1, failed: 0 });
    expect(t.types()).toEqual(['ClassSessionCreated', 'ClassSessionStarted', 'ClassSessionCompleted']);
  });

  it('completion creates, checks and changes no teaching record: it only moves the status (no such dependency exists in the service)', async () => {
    const t = createSessionFakes();
    await openSession(t);
    t.clock.set(END);
    await t.service.runCycle();
    expect(t.all()).toHaveLength(1);
    expect(t.all()[0]!.status).toBe('COMPLETED');
  });
});

describe('cancellation by the assigned Teacher', () => {
  it('needs a non-empty reason and records who, when and why', async () => {
    const t = createSessionFakes();
    const s = await openSession(t);
    t.clock.set(at('2026-11-02T15:50:00Z'));
    for (const reason of [undefined, null, '', '   ', 5]) {
      await expect(t.service.cancelSession(s.id, TEACHER.userId, reason)).rejects.toMatchObject({ code: 'CLASS_SESSION_CANCEL_REASON_REQUIRED' });
    }
    await expect(t.service.cancelSession(s.id, TEACHER.userId, 'x'.repeat(501))).rejects.toMatchObject({ code: 'CLASS_SESSION_CANCEL_REASON_TOO_LONG' });
    expect(t.all()[0]!.status).toBe('OPEN');
    const dto = await t.service.cancelSession(s.id, TEACHER.userId, '  مريض  ');
    expect(dto).toMatchObject({ status: 'CANCELLED', cancelledBy: TEACHER.userId, cancelSource: 'TEACHER', cancelReason: 'مريض', slotRetireReason: null, cancelledAt: at('2026-11-02T15:50:00Z') });
    expect(t.types()).toEqual(['ClassSessionCreated', 'ClassSessionCancelled']);
    expect(t.events.at(-1)!.payload).toMatchObject({ cancelSource: 'TEACHER', actorId: TEACHER.userId, reason: 'مريض' });
  });

  it('works while IN_PROGRESS', async () => {
    const t = createSessionFakes();
    const s = await openSession(t);
    t.clock.set(at('2026-11-02T16:20:00Z'));
    const dto = await t.service.cancelSession(s.id, TEACHER.userId, 'طارئ');
    expect(dto.status).toBe('CANCELLED');
    expect(dto.startedAt).toEqual(at('2026-11-02T16:20:00Z')); // the start was applied first (time had passed)
  });

  it('only the assigned Teacher; an unknown user is not a Teacher', async () => {
    const t = createSessionFakes();
    const s = await openSession(t);
    await expect(t.service.cancelSession(s.id, OTHER_TEACHER.userId, 'x')).rejects.toMatchObject({ code: 'CLASS_SESSION_NOT_ASSIGNED_TEACHER' });
    await expect(t.service.cancelSession(s.id, 'nobody', 'x')).rejects.toMatchObject({ code: 'CLASS_SESSION_NOT_ASSIGNED_TEACHER' });
    await expect(t.service.cancelSession('missing', TEACHER.userId, 'x')).rejects.toMatchObject({ code: 'CLASS_SESSION_NOT_FOUND' });
    expect(t.all()[0]!.status).toBe('OPEN');
  });

  it('a COMPLETED session cannot be cancelled, including one that reached its end before the job ran', async () => {
    const t = createSessionFakes();
    const s = await openSession(t);
    t.clock.set(END);
    await expect(t.service.cancelSession(s.id, TEACHER.userId, 'متأخر')).rejects.toMatchObject({ code: 'CLASS_SESSION_NOT_CANCELLABLE', details: { status: 'COMPLETED' } });
    await t.service.advanceDueSessions();
    await expect(t.service.cancelSession(s.id, TEACHER.userId, 'متأخر')).rejects.toMatchObject({ code: 'CLASS_SESSION_NOT_CANCELLABLE' });
    expect(t.all()[0]!.status).toBe('COMPLETED');
    expect(t.all()[0]!.cancelledAt).toBeNull();
  });

  it('a second cancellation is refused and the original reason, actor and source are kept', async () => {
    const t = createSessionFakes();
    const s = await openSession(t);
    await t.service.cancelSession(s.id, TEACHER.userId, 'الأول');
    t.clock.set(at('2026-11-02T15:55:00Z'));
    await expect(t.service.cancelSession(s.id, TEACHER.userId, 'الثاني')).rejects.toMatchObject({ code: 'CLASS_SESSION_NOT_CANCELLABLE', details: { status: 'CANCELLED' } });
    expect(t.all()[0]).toMatchObject({ cancelReason: 'الأول', cancelSource: 'TEACHER', cancelledAt: THRESHOLD });
  });

  it('sessions are never deleted: there is no delete in the repository or the service', () => {
    const t = createSessionFakes();
    expect(Object.keys(t.service).concat(Object.getOwnPropertyNames(Object.getPrototypeOf(t.service)))).not.toContain('delete');
    expect(Object.getOwnPropertyNames(Object.getPrototypeOf(t.repo)).filter((n) => /delete|remove/i.test(n))).toEqual([]);
  });
});

describe('a cancelled or retired schedule slot', () => {
  const retire = (t: ReturnType<typeof createSessionFakes>, when: string, reason: 'REPLACED' | 'REMOVED' | 'GROUP_ARCHIVED' = 'REMOVED') => {
    t.slots[0]!.retiredAt = at(when);
    t.slots[0]!.retireReason = reason;
  };
  const eventOf = (when: string, reason = 'REMOVED'): DomainEvent => ({ eventType: 'GroupScheduleSlotRetired', payload: { slotId: 'slot-1', reason }, occurredAt: at(when) }) as unknown as DomainEvent;

  it('before the session was created: it is never created', async () => {
    const t = createSessionFakes();
    retire(t, '2026-11-02T10:00:00Z');
    t.clock.set(THRESHOLD);
    await t.service.runCycle();
    expect(t.all()).toHaveLength(0);
  });

  it('after creation but before the start: cancelled automatically, recording the slot retirement (event path)', async () => {
    const t = createSessionFakes();
    await openSession(t);
    retire(t, '2026-11-02T15:50:00Z', 'REPLACED');
    t.clock.set(at('2026-11-02T15:50:05Z'));
    await t.retiredHandler.handle(eventOf('2026-11-02T15:50:00Z', 'REPLACED'));
    expect(t.all()[0]).toMatchObject({ status: 'CANCELLED', cancelSource: 'SCHEDULE_SLOT_RETIRED', slotRetireReason: 'REPLACED', cancelledBy: null, cancelReason: null });
    expect(t.events.at(-1)!.payload).toMatchObject({ cancelSource: 'SCHEDULE_SLOT_RETIRED', slotRetireReason: 'REPLACED', actorId: null });
    await t.retiredHandler.handle(eventOf('2026-11-02T15:50:00Z', 'REPLACED')); // delivered twice
    expect(t.types().filter((x) => x === 'ClassSessionCancelled')).toHaveLength(1);
  });

  it('the safety net finds it too when the event was missed (reconciliation)', async () => {
    const t = createSessionFakes();
    await openSession(t);
    retire(t, '2026-11-02T15:50:00Z', 'GROUP_ARCHIVED');
    t.clock.set(at('2026-11-02T15:51:00Z'));
    expect(await t.service.reconcileRetiredSlots()).toBe(1);
    expect(t.all()[0]).toMatchObject({ status: 'CANCELLED', cancelSource: 'SCHEDULE_SLOT_RETIRED', slotRetireReason: 'GROUP_ARCHIVED' });
  });

  it('retired just before the start but processed just after: still cancelled (the retirement time decides)', async () => {
    const t = createSessionFakes();
    await openSession(t);
    retire(t, '2026-11-02T15:59:50Z');
    t.clock.set(at('2026-11-02T16:00:10Z'));
    await t.service.runCycle();
    expect(t.all()[0]!.status).toBe('CANCELLED');
  });

  it('after the session started: not cancelled', async () => {
    const t = createSessionFakes();
    await openSession(t);
    t.clock.set(at('2026-11-02T16:10:00Z'));
    await t.service.advanceDueSessions();
    retire(t, '2026-11-02T16:10:00Z');
    await t.retiredHandler.handle(eventOf('2026-11-02T16:10:00Z'));
    await t.service.reconcileRetiredSlots();
    expect(t.all()[0]!.status).toBe('IN_PROGRESS');
  });

  it('after completion: unchanged', async () => {
    const t = createSessionFakes();
    await openSession(t);
    t.clock.set(END);
    await t.service.advanceDueSessions();
    retire(t, '2026-11-02T17:05:00Z');
    await t.retiredHandler.handle(eventOf('2026-11-02T17:05:00Z'));
    await t.service.reconcileRetiredSlots();
    expect(t.all()[0]!.status).toBe('COMPLETED');
  });

  it('already cancelled by the Teacher: the original reason, actor and source are preserved', async () => {
    const t = createSessionFakes();
    const s = await openSession(t);
    await t.service.cancelSession(s.id, TEACHER.userId, 'سبب المعلم');
    retire(t, '2026-11-02T15:56:00Z');
    await t.retiredHandler.handle(eventOf('2026-11-02T15:56:00Z'));
    await t.service.reconcileRetiredSlots();
    expect(t.all()[0]).toMatchObject({ cancelSource: 'TEACHER', cancelReason: 'سبب المعلم', cancelledBy: TEACHER.userId, slotRetireReason: null });
    expect(t.types().filter((x) => x === 'ClassSessionCancelled')).toHaveLength(1);
  });

  it('only the sessions of the retired slot are touched, and unknown reasons are ignored', async () => {
    const t = createSessionFakes([fakeSlot(), fakeSlot({ id: 'slot-2', groupId: 'group-2' })]);
    t.clock.set(THRESHOLD);
    await t.service.generateDueSessions();
    t.slots[0]!.retiredAt = at('2026-11-02T15:50:00Z');
    t.slots[0]!.retireReason = 'REMOVED';
    await t.retiredHandler.handle(eventOf('2026-11-02T15:50:00Z'));
    await t.retiredHandler.handle({ eventType: 'GroupScheduleSlotRetired', payload: { slotId: 'slot-2', reason: 'WHATEVER' }, occurredAt: at('2026-11-02T15:50:00Z') } as unknown as DomainEvent);
    expect(t.all().map((s) => `${s.slotId}:${s.status}`).sort()).toEqual(['slot-1:CANCELLED', 'slot-2:OPEN']);
  });
});

describe('reads', () => {
  it('lists a group\'s and a Teacher\'s sessions, filtered by status, newest first; an unknown user has none', async () => {
    const t = createSessionFakes();
    await openSession(t);
    t.clock.set(at('2026-11-09T15:45:00Z'));
    await t.service.generateDueSessions();
    const page = { page: 1, pageSize: 10 };
    const group = await t.service.listGroupSessions('group-1', { page });
    expect(group.items.map((s) => s.occurrenceDate)).toEqual(['2026-11-09', '2026-11-02']);
    expect((await t.service.listGroupSessions('group-1', { page, direction: 'asc' })).items.map((s) => s.occurrenceDate)).toEqual(['2026-11-02', '2026-11-09']);
    expect((await t.service.listGroupSessions('group-1', { page, status: ['COMPLETED'] })).items).toHaveLength(0);
    expect((await t.service.listOwnSessions(TEACHER.userId, { page })).items).toHaveLength(2);
    expect((await t.service.listOwnSessions(OTHER_TEACHER.userId, { page })).items).toHaveLength(0);
    expect((await t.service.listOwnSessions('nobody', { page })).items).toHaveLength(0);
    expect(await t.service.findGroupIdOf(group.items[0]!.id)).toBe('group-1');
    await expect(t.service.getSession('missing')).rejects.toMatchObject({ code: 'CLASS_SESSION_NOT_FOUND' });
    expect(NOW0).toBeInstanceOf(Date);
  });
});
