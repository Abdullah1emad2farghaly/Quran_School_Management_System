import { beforeEach, describe, expect, it } from 'vitest';
import { SessionEventTypes } from '../../../src/modules/24-sessions/public';
import { ReminderProcessor, REMINDER_KINDS } from '../../../src/modules/32-notification-rules/public';
import { HOUR, MIN, createRulesHarness, ids, type RulesHarness } from '../../helpers/notification-rules-harness';

let w: RulesHarness;
let start: Date;
let end: Date;

/** A one-hour session starting 10 minutes from "now". */
const created = (sessionId = ids.session) => ({ sessionId, groupId: ids.group1, schoolId: ids.school, teacherId: ids.teacher1, scheduledStart: start.toISOString(), scheduledEnd: end.toISOString() });

const setActivity = (status: string, over: { memorizationPending?: boolean; revisionPending?: boolean } = {}, sessionId = ids.session) =>
  w.sessions.activity.set(sessionId, { status, teacherId: ids.teacher1, scheduledStart: start, scheduledEnd: end, memorizationPending: over.memorizationPending ?? false, revisionPending: over.revisionPending ?? false });
const setEvaluation = (status: string, incomplete: string[], sessionId = ids.session) =>
  w.sessions.evaluation.set(sessionId, { status, teacherId: ids.teacher1, groupId: ids.group1, scheduledStart: start, scheduledEnd: end, incompleteStudentIds: incomplete });
const jumpTo = (instant: Date) => w.h.advance(instant.getTime() - w.h.clock.now().getTime());

beforeEach(async () => {
  w = createRulesHarness();
  start = new Date(w.h.clock.now().getTime() + 10 * MIN);
  end = new Date(start.getTime() + HOUR);
  await w.deliver(SessionEventTypes.CREATED, created());
});

describe('scheduling', () => {
  it('a created session schedules the half-session reminder and the 15-minute evaluation warning', async () => {
    const half = await w.state.findReminder(REMINDER_KINDS.SESSION_HALF_TIME, ids.session);
    const warn = await w.state.findReminder(REMINDER_KINDS.SESSION_EVALUATION, ids.session);
    expect(half?.dueAt.getTime()).toBe(start.getTime() + 30 * MIN);
    expect(warn?.dueAt.getTime()).toBe(end.getTime() - 15 * MIN);
  });
  it('redelivering the created event does not revive a reminder that was already handled', async () => {
    const event = w.makeEvent(SessionEventTypes.CREATED, created());
    await w.redeliver(event);
    jumpTo(new Date(start.getTime() + 31 * MIN));
    setActivity('IN_PROGRESS', { memorizationPending: true });
    expect((await w.processor.processDue()).sent).toBe(1);
    await w.redeliver(event);
    expect((await w.state.findReminder(REMINDER_KINDS.SESSION_HALF_TIME, ids.session))?.state).toBe('SENT');
  });
});

describe('half-session reminder', () => {
  it('is not sent before half the session has passed', async () => {
    jumpTo(new Date(start.getTime() + 29 * MIN));
    setActivity('IN_PROGRESS', { memorizationPending: true });
    expect((await w.processor.processDue()).sent).toBe(0);
  });
  it('tells the assigned Teacher only when memorization was scheduled and has no record yet', async () => {
    jumpTo(new Date(start.getTime() + 31 * MIN));
    setActivity('IN_PROGRESS', { memorizationPending: true });
    expect((await w.processor.processDue()).sent).toBe(1);
    expect(w.allNotifications()).toHaveLength(1);
    expect(w.notificationsOf(ids.teacherUser1)).toHaveLength(1);
    expect(w.notificationsOf(ids.teacherUser1)[0]?.body).toContain('memorization');
  });
  it('names both activities when both are pending, and only revision when only revision is', async () => {
    jumpTo(new Date(start.getTime() + 31 * MIN));
    setActivity('IN_PROGRESS', { memorizationPending: true, revisionPending: true });
    await w.processor.processDue();
    expect(w.notificationsOf(ids.teacherUser1)[0]?.body).toContain('memorization and revision');
    const w2 = createRulesHarness();
    await w2.deliver(SessionEventTypes.CREATED, created());
    w2.sessions.activity.set(ids.session, { status: 'IN_PROGRESS', teacherId: ids.teacher1, scheduledStart: start, scheduledEnd: end, memorizationPending: false, revisionPending: true });
    w2.h.advance(start.getTime() + 31 * MIN - w2.h.clock.now().getTime());
    await w2.processor.processDue();
    expect(w2.notificationsOf(ids.teacherUser1)[0]?.type).toBe('SESSION_HALF_TIME_REMINDER');
    expect(w2.notificationsOf(ids.teacherUser1)[0]?.body).toContain('revision');
    expect(w2.notificationsOf(ids.teacherUser1)[0]?.body).not.toContain('memorization');
  });
  it('sends nothing for an activity that was not scheduled or already has its record', async () => {
    jumpTo(new Date(start.getTime() + 31 * MIN));
    setActivity('IN_PROGRESS', { memorizationPending: false, revisionPending: false });
    expect((await w.processor.processDue()).suppressed).toBe(1);
    expect(w.allNotifications()).toHaveLength(0);
  });
  it('DELAYED SCHEDULER: a reminder missed by an outage is sent at once when the scheduler resumes, while the session is still in progress', async () => {
    jumpTo(new Date(start.getTime() + 50 * MIN)); // the scheduler was down since before the half-time; 10 minutes remain
    setActivity('IN_PROGRESS', { memorizationPending: true });
    expect((await w.processor.processDue()).sent).toBe(1);
    expect(w.notificationsOf(ids.teacherUser1)).toHaveLength(1);
  });
  it('DELAYED SCHEDULER: a missed reminder is NOT sent once the session has ended or been cancelled', async () => {
    jumpTo(new Date(end.getTime() + MIN));
    setActivity('COMPLETED', { memorizationPending: true });
    expect((await w.processor.processDue()).suppressed).toBeGreaterThan(0);
    expect(w.allNotifications()).toHaveLength(0);
  });
  it('is suppressed when the session is cancelled before the reminder is due (event), and never sent afterwards', async () => {
    await w.deliver(SessionEventTypes.CANCELLED, { sessionId: ids.session, groupId: ids.group1, schoolId: ids.school });
    jumpTo(new Date(start.getTime() + 35 * MIN));
    setActivity('IN_PROGRESS', { memorizationPending: true });
    expect(await w.processor.processDue()).toEqual({ sent: 0, suppressed: 0, postponed: 0, retried: 0, failed: 0 });
    expect(w.allNotifications()).toHaveLength(0);
    expect((await w.state.findReminder(REMINDER_KINDS.SESSION_EVALUATION, ids.session))?.state).toBe('SUPPRESSED');
  });
  it('a session the scheduler has not started yet is looked at again shortly, not dropped', async () => {
    jumpTo(new Date(start.getTime() + 31 * MIN));
    setActivity('OPEN', { memorizationPending: true });
    expect((await w.processor.processDue()).postponed).toBe(1);
    setActivity('IN_PROGRESS', { memorizationPending: true });
    w.h.advance(31_000);
    expect((await w.processor.processDue()).sent).toBe(1);
  });
  it('is sent once only', async () => {
    jumpTo(new Date(start.getTime() + 31 * MIN));
    setActivity('IN_PROGRESS', { memorizationPending: true });
    await w.processor.processDue();
    await w.processor.processDue();
    expect(w.notificationsOf(ids.teacherUser1)).toHaveLength(1);
  });
});

describe('evaluation warning (15 minutes before the end)', () => {
  it('is not sent before 15 minutes remain', async () => {
    jumpTo(new Date(end.getTime() - 16 * MIN));
    setEvaluation('IN_PROGRESS', [ids.studentA]);
    expect((await w.processor.processDue()).sent).toBe(0);
  });
  it('tells the assigned Teacher only when present students still lack the evaluation, with the count', async () => {
    jumpTo(new Date(end.getTime() - 15 * MIN));
    setEvaluation('IN_PROGRESS', [ids.studentA, ids.studentB]);
    expect((await w.processor.processDue()).sent).toBeGreaterThanOrEqual(1);
    const [n] = w.notificationsOf(ids.teacherUser1).filter((x) => x.type === 'SESSION_EVALUATION_WARNING');
    expect(n?.body).toContain('(2)');
    expect(w.notificationsOf(ids.parentA)).toHaveLength(0);
  });
  it('sends nothing when nobody present lacks an evaluation', async () => {
    jumpTo(new Date(end.getTime() - 14 * MIN));
    setEvaluation('IN_PROGRESS', []);
    await w.processor.processDue();
    expect(w.allNotifications().filter((x) => x.type === 'SESSION_EVALUATION_WARNING')).toHaveLength(0);
  });
  it('DELAYED SCHEDULER: sent immediately on resume while the session is still in progress', async () => {
    jumpTo(new Date(end.getTime() - 2 * MIN));
    setEvaluation('IN_PROGRESS', [ids.studentA]);
    await w.processor.processDue();
    expect(w.allNotifications().filter((x) => x.type === 'SESSION_EVALUATION_WARNING')).toHaveLength(1);
  });
  it('DELAYED SCHEDULER: not sent when the session already ended or was cancelled', async () => {
    jumpTo(new Date(end.getTime() + 5 * MIN));
    setEvaluation('COMPLETED', [ids.studentA]);
    await w.processor.processDue();
    expect(w.allNotifications()).toHaveLength(0);
    const w2 = createRulesHarness();
    await w2.deliver(SessionEventTypes.CREATED, created());
    w2.sessions.evaluation.set(ids.session, { status: 'CANCELLED', teacherId: ids.teacher1, groupId: ids.group1, scheduledStart: start, scheduledEnd: end, incompleteStudentIds: [ids.studentA] });
    w2.h.advance(end.getTime() - 5 * MIN - w2.h.clock.now().getTime());
    await w2.processor.processDue();
    expect(w2.allNotifications()).toHaveLength(0);
  });
  it('the session completing suppresses the pending reminders', async () => {
    await w.deliver(SessionEventTypes.COMPLETED, { sessionId: ids.session, groupId: ids.group1, schoolId: ids.school });
    expect((await w.state.findReminder(REMINDER_KINDS.SESSION_HALF_TIME, ids.session))?.state).toBe('SUPPRESSED');
    expect((await w.state.findReminder(REMINDER_KINDS.SESSION_EVALUATION, ids.session))?.state).toBe('SUPPRESSED');
  });
});

describe('worker behaviour', () => {
  it('two workers running at the same time never process one reminder twice (claim lock)', async () => {
    jumpTo(new Date(start.getTime() + 31 * MIN));
    setActivity('IN_PROGRESS', { memorizationPending: true });
    setEvaluation('IN_PROGRESS', [ids.studentA]);
    jumpTo(new Date(end.getTime() - 10 * MIN));
    const other = new ReminderProcessor(w.deps);
    const [a, b] = await Promise.all([w.processor.processDue(), other.processDue()]);
    expect(a.sent + b.sent).toBe(2); // half-time + evaluation warning, each exactly once overall
    expect(w.notificationsOf(ids.teacherUser1)).toHaveLength(2);
  });
  it('gives up (FAILED) after repeated technical errors and does not block other reminders', async () => {
    jumpTo(new Date(end.getTime() - 10 * MIN));
    setActivity('IN_PROGRESS', { memorizationPending: true });
    w.sessions.failEvaluation = true;
    setEvaluation('IN_PROGRESS', [ids.studentA]);
    let failed = 0;
    for (let i = 0; i < 6; i += 1) {
      failed += (await w.processor.processDue()).failed;
      w.h.advance(5 * MIN);
    }
    expect(failed).toBe(1);
    expect((await w.state.findReminder(REMINDER_KINDS.SESSION_EVALUATION, ids.session))?.state).toBe('FAILED');
    expect(w.notificationsOf(ids.teacherUser1).some((n) => n.type === 'SESSION_HALF_TIME_REMINDER')).toBe(true);
  });
});

describe('no backfill (decision 5)', () => {
  it('a session already over when its event is handled gets no reminders and sends nothing later', async () => {
    const old = '00000000-0000-4000-8000-0000000000e9';
    const oldStart = new Date(w.h.clock.now().getTime() - 3 * HOUR);
    await w.deliver(SessionEventTypes.CREATED, { sessionId: old, groupId: ids.group1, schoolId: ids.school, teacherId: ids.teacher1, scheduledStart: oldStart.toISOString(), scheduledEnd: new Date(oldStart.getTime() + HOUR).toISOString() });
    expect(await w.state.findReminder(REMINDER_KINDS.SESSION_HALF_TIME, old)).toBeUndefined();
    expect(await w.state.findReminder(REMINDER_KINDS.SESSION_EVALUATION, old)).toBeUndefined();
  });
  it('a session generated before deployment (no event ever handled) has no reminder rows, so nothing is sent for it', async () => {
    const legacy = '00000000-0000-4000-8000-0000000000e8';
    setActivity('IN_PROGRESS', { memorizationPending: true }, legacy);
    jumpTo(new Date(start.getTime() + 31 * MIN));
    const result = await w.processor.processDue();
    expect(w.notificationsOf(ids.teacherUser1).filter((n) => n.data !== undefined && JSON.stringify(n.data).includes(legacy))).toHaveLength(0);
    expect(result.sent).toBe(0);
  });
});
