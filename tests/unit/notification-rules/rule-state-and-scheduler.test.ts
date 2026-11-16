import { describe, expect, it } from 'vitest';
import { InMemoryRuleStateRepository, ReminderScheduler, REMINDER_KINDS } from '../../../src/modules/32-notification-rules/public';

const T0 = new Date('2026-11-05T09:00:00.000Z');
const at = (ms: number) => new Date(T0.getTime() + ms);
const SUBJECT = '00000000-0000-4000-8000-0000000000aa';

describe('reminder state (the rules the MariaDB repository implements identically)', () => {
  it('creates one row per (kind, subject); the same due time again changes nothing', async () => {
    const r = new InMemoryRuleStateRepository();
    await r.upsertReminder(REMINDER_KINDS.EXAM_24H, SUBJECT, at(1000), T0);
    await r.upsertReminder(REMINDER_KINDS.EXAM_24H, SUBJECT, at(1000), T0);
    expect(r.reminders.size).toBe(1);
    const [row] = await r.claimDue({ claimId: 'c1', now: at(2000), lockUntil: at(60_000), limit: 10 });
    await r.complete(row!.id, 'SENT', at(2000));
    await r.upsertReminder(REMINDER_KINDS.EXAM_24H, SUBJECT, at(1000), at(3000)); // a redelivered event
    expect((await r.findReminder(REMINDER_KINDS.EXAM_24H, SUBJECT))?.state).toBe('SENT');
  });
  it('a moved due time re-arms the reminder (PENDING again, attempts reset)', async () => {
    const r = new InMemoryRuleStateRepository();
    await r.upsertReminder(REMINDER_KINDS.EXAM_24H, SUBJECT, at(1000), T0);
    const [row] = await r.claimDue({ claimId: 'c1', now: at(2000), lockUntil: at(60_000), limit: 10 });
    await r.recordFailure(row!.id, 3, null, 'boom', at(2000));
    expect((await r.findReminder(REMINDER_KINDS.EXAM_24H, SUBJECT))?.state).toBe('FAILED');
    await r.upsertReminder(REMINDER_KINDS.EXAM_24H, SUBJECT, at(9000), at(3000));
    const re = await r.findReminder(REMINDER_KINDS.EXAM_24H, SUBJECT);
    expect(re?.state).toBe('PENDING');
    expect(re?.attempts).toBe(0);
  });
  it('claims only due PENDING rows, oldest first, and locks them', async () => {
    const r = new InMemoryRuleStateRepository();
    await r.upsertReminder(REMINDER_KINDS.SESSION_HALF_TIME, 's-late', at(5000), T0);
    await r.upsertReminder(REMINDER_KINDS.SESSION_HALF_TIME, 's-early', at(1000), T0);
    await r.upsertReminder(REMINDER_KINDS.SESSION_HALF_TIME, 's-future', at(99_000), T0);
    const first = await r.claimDue({ claimId: 'a', now: at(6000), lockUntil: at(66_000), limit: 10 });
    expect(first.map((x) => x.subjectId)).toEqual(['s-early', 's-late']);
    expect(await r.claimDue({ claimId: 'b', now: at(7000), lockUntil: at(67_000), limit: 10 })).toEqual([]); // locked
    expect((await r.claimDue({ claimId: 'c', now: at(70_000), lockUntil: at(130_000), limit: 10 })).length).toBe(2); // the lock expired (a crashed worker)
  });
  it('suppresses only PENDING reminders of the subject and the kinds asked', async () => {
    const r = new InMemoryRuleStateRepository();
    await r.upsertReminder(REMINDER_KINDS.SESSION_HALF_TIME, SUBJECT, at(1000), T0);
    await r.upsertReminder(REMINDER_KINDS.SESSION_EVALUATION, SUBJECT, at(2000), T0);
    await r.upsertReminder(REMINDER_KINDS.SESSION_EVALUATION, 'other', at(2000), T0);
    expect(await r.suppressPending(SUBJECT, [REMINDER_KINDS.SESSION_HALF_TIME], at(3000))).toBe(1);
    expect((await r.findReminder(REMINDER_KINDS.SESSION_EVALUATION, SUBJECT))?.state).toBe('PENDING');
    expect((await r.findReminder(REMINDER_KINDS.SESSION_EVALUATION, 'other'))?.state).toBe('PENDING');
    expect(await r.suppressPending(SUBJECT, [REMINDER_KINDS.SESSION_HALF_TIME], at(4000))).toBe(0);
  });
  it('keeps the exam audience per exam and role, and clears both roles together', async () => {
    const r = new InMemoryRuleStateRepository();
    await r.replaceExamAudience('e1', 'STUDENT', ['a', 'b'], T0);
    await r.addExamAudience('e1', 'EXAMINER', 't1', T0);
    await r.addExamAudience('e2', 'STUDENT', 'z', T0);
    await r.removeExamAudience('e1', 'STUDENT', 'a');
    expect(await r.listExamAudience('e1', 'STUDENT')).toEqual(['b']);
    await r.clearExamAudience('e1');
    expect(await r.listExamAudience('e1', 'STUDENT')).toEqual([]);
    expect(await r.listExamAudience('e1', 'EXAMINER')).toEqual([]);
    expect(await r.listExamAudience('e2', 'STUDENT')).toEqual(['z']);
  });
});

describe('reminder scheduler', () => {
  const result = { sent: 1, suppressed: 0, postponed: 0, retried: 0, failed: 0 };
  it('runs a pass on demand and reports a pass that did something', async () => {
    const seen: unknown[] = [];
    const s = new ReminderScheduler({ job: { processDue: async () => result }, onResult: (r) => seen.push(r) });
    expect(await s.tick()).toBe(true);
    expect(seen).toHaveLength(1);
  });
  it('never overlaps two passes', async () => {
    let release: () => void = () => undefined;
    let calls = 0;
    const s = new ReminderScheduler({ job: { processDue: () => new Promise((resolve) => { calls += 1; release = () => resolve(result); }) } });
    const first = s.tick();
    expect(await s.tick()).toBe(false);
    release();
    await first;
    expect(calls).toBe(1);
  });
  it('an error in a pass is reported and never stops the next pass', async () => {
    const errors: unknown[] = [];
    let n = 0;
    const s = new ReminderScheduler({ job: { processDue: async () => { n += 1; if (n === 1) throw new Error('db down'); return result; } }, onError: (e) => errors.push(e) });
    await s.tick();
    await s.tick();
    expect(errors).toHaveLength(1);
    expect(n).toBe(2);
  });
});
