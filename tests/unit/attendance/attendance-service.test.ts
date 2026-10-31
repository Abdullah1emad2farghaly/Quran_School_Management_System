import { describe, expect, it } from 'vitest';
import { AttendanceRecord, InMemoryAttendanceRepository, SYSTEM_ACTOR_ID, createMarkTeacherAbsentOnSessionEndHandler } from '../../../src/modules/26-attendance/public';
import type { DomainEvent } from '../../../src/modules/00-shared-kernel/public';
import { GPS, MANAGER, OTHER_TEACHER, OTHER_USER, STUDENTS, TEACHER, createAttendanceFakes, fakeSession } from '../../helpers/attendance-fakes';

const at = (iso: string) => new Date(iso);
const batch = (t: ReturnType<typeof createAttendanceFakes>, records: unknown, over: { userId?: string; gps?: unknown; sessionId?: string } = {}) =>
  t.service.recordStudentAttendance(over.sessionId ?? 'session-1', over.userId ?? TEACHER.userId, { gps: over.gps ?? GPS, records });
const refused = async (promise: Promise<unknown>, code: string) => expect(promise).rejects.toMatchObject({ code });
const present = (...ids: string[]) => ids.map((studentId) => ({ studentId, status: 'PRESENT' }));

describe('the assigned Teacher records students in one atomic batch through Smart Guard', () => {
  it('creates a record per student (RECORDED, no reason needed) and publishes AttendanceRecorded for each', async () => {
    const t = createAttendanceFakes();
    const result = await batch(t, [{ studentId: 'student-1', status: 'PRESENT' }, { studentId: 'student-2', status: 'ABSENT' }]);
    expect(result.results.map((r) => [r.subjectId, r.outcome, r.record.status])).toEqual([['student-1', 'RECORDED', 'PRESENT'], ['student-2', 'RECORDED', 'ABSENT']]);
    expect(result.results[0]!.record).toMatchObject({ sessionId: 'session-1', schoolId: 'school-1', groupId: 'group-1', subjectType: 'STUDENT', recordedBy: TEACHER.userId, recordedByRole: 'TEACHER', occurrenceDate: '2026-11-02' });
    expect(t.types()).toEqual(['AttendanceRecorded', 'AttendanceRecorded']);
    expect(t.events[0]!.payload).toMatchObject({ subjectId: 'student-1', status: 'PRESENT', actorUserId: TEACHER.userId, actorRole: 'TEACHER' });
  });

  it('calls Smart Guard ONCE for the whole batch with the Teacher record, the session and the GPS reading', async () => {
    const t = createAttendanceFakes();
    await batch(t, present(...STUDENTS));
    expect(t.state.guardCalls).toEqual([{ teacherId: TEACHER.teacherId, sessionId: 'session-1', gps: GPS }]);
  });

  it('when Smart Guard refuses, nothing is written and nothing is published', async () => {
    const t = createAttendanceFakes();
    t.state.guardRejects = Object.assign(new Error('x'), { code: 'SMART_GUARD_OUTSIDE_SCHOOL_GEOFENCE' });
    await refused(batch(t, present('student-1')), 'SMART_GUARD_OUTSIDE_SCHOOL_GEOFENCE');
    expect(t.repo.rows.size).toBe(0);
    expect(t.events).toHaveLength(0);
  });

  it('a user who is not a Teacher is refused like any non-owner, without reaching Smart Guard', async () => {
    const t = createAttendanceFakes();
    await refused(batch(t, present('student-1'), { userId: OTHER_USER }), 'SMART_GUARD_NOT_SESSION_TEACHER');
    expect(t.state.guardCalls).toHaveLength(0);
  });

  it('students nobody marks stay UNMARKED: nothing is created, nothing is marked ABSENT', async () => {
    const t = createAttendanceFakes();
    await batch(t, present('student-1'));
    expect([...t.repo.rows.values()].map((r) => r.subjectId)).toEqual(['student-1']);
    t.clock.set(at('2026-11-02T18:00:00Z')); // long after the session ended
    expect([...t.repo.rows.values()]).toHaveLength(1);
    expect(t.types()).toEqual(['AttendanceRecorded']);
  });

  it('only students CURRENTLY assigned to the session\'s group: any other student rejects the WHOLE batch (atomic)', async () => {
    const t = createAttendanceFakes();
    t.assigned.set('student-3', []); // left the group
    t.assigned.set('student-9', ['group-2']); // in another group
    await expect(batch(t, present('student-1', 'student-3', 'student-9'))).rejects.toMatchObject({ code: 'ATTENDANCE_STUDENT_NOT_IN_GROUP', details: { studentIds: ['student-3', 'student-9'] } });
    expect(t.repo.rows.size).toBe(0);
    expect(t.events).toHaveLength(0);
  });

  it('is atomic: a correction without a reason anywhere in the batch rejects ALL of it, including the valid new records', async () => {
    const t = createAttendanceFakes();
    await batch(t, [{ studentId: 'student-1', status: 'PRESENT' }]);
    t.events.length = 0;
    await refused(batch(t, [{ studentId: 'student-2', status: 'PRESENT' }, { studentId: 'student-1', status: 'ABSENT' }]), 'ATTENDANCE_CORRECTION_REASON_REQUIRED');
    expect([...t.repo.rows.values()].map((r) => `${r.subjectId}:${r.status}`)).toEqual(['student-1:PRESENT']);
    expect(t.events).toHaveLength(0);
    expect(t.repo.corrections).toHaveLength(0);
  });

  it('rejects malformed batches before Smart Guard is called', async () => {
    const t = createAttendanceFakes();
    for (const [records, code] of [
      [undefined, 'ATTENDANCE_RECORDS_REQUIRED'], [[], 'ATTENDANCE_RECORDS_REQUIRED'], ['x', 'ATTENDANCE_RECORDS_REQUIRED'],
      [Array.from({ length: 201 }, (_, i) => ({ studentId: `s${i}`, status: 'PRESENT' })), 'ATTENDANCE_TOO_MANY_RECORDS'],
      [[{ status: 'PRESENT' }], 'ATTENDANCE_INVALID_RECORD'], [[{ studentId: '', status: 'PRESENT' }], 'ATTENDANCE_INVALID_RECORD'], [['x'], 'ATTENDANCE_INVALID_RECORD'],
      [[{ studentId: 'student-1', status: 'LATE' }], 'ATTENDANCE_INVALID_STATUS'], [[{ studentId: 'student-1' }], 'ATTENDANCE_INVALID_STATUS'],
      [[{ studentId: 'student-1', status: 'PRESENT' }, { studentId: 'student-1', status: 'ABSENT' }], 'ATTENDANCE_DUPLICATE_STUDENT'],
    ] as Array<[unknown, string]>) {
      await refused(batch(t, records), code);
    }
    expect(t.state.guardCalls).toHaveLength(0);
    expect(t.repo.rows.size).toBe(200 * 0);
  });
});

describe('corrections: reason required, history append-only, events', () => {
  async function marked(t: ReturnType<typeof createAttendanceFakes>) {
    await batch(t, [{ studentId: 'student-1', status: 'PRESENT' }]);
    t.events.length = 0;
    t.clock.set(at('2026-11-02T16:40:00Z'));
  }

  it('changing an existing record needs a non-empty reason (missing, blank, not a string)', async () => {
    const t = createAttendanceFakes();
    await marked(t);
    for (const reason of [undefined, null, '', '   ', 5]) {
      await refused(batch(t, [{ studentId: 'student-1', status: 'ABSENT', reason }]), 'ATTENDANCE_CORRECTION_REASON_REQUIRED');
    }
    await refused(batch(t, [{ studentId: 'student-1', status: 'ABSENT', reason: 'x'.repeat(501) }]), 'ATTENDANCE_REASON_TOO_LONG');
    expect([...t.repo.rows.values()][0]!.status).toBe('PRESENT');
    expect(t.repo.corrections).toHaveLength(0);
  });

  it('a correction updates the record, appends a history entry (actor, role, time, previous, new, reason) and publishes AttendanceCorrected', async () => {
    const t = createAttendanceFakes();
    await marked(t);
    const result = await batch(t, [{ studentId: 'student-1', status: 'ABSENT', reason: '  سُجّل خطأً  ' }]);
    expect(result.results[0]).toMatchObject({ outcome: 'CORRECTED', record: { status: 'ABSENT', recordedBy: TEACHER.userId, updatedBy: TEACHER.userId, updatedByRole: 'TEACHER' } });
    expect(t.repo.corrections).toHaveLength(1);
    expect(t.repo.corrections[0]).toMatchObject({ sessionId: 'session-1', subjectType: 'STUDENT', subjectId: 'student-1', previousStatus: 'PRESENT', newStatus: 'ABSENT', reason: 'سُجّل خطأً', changedBy: TEACHER.userId, changedByRole: 'TEACHER', changedAt: at('2026-11-02T16:40:00Z') });
    expect(t.types()).toEqual(['AttendanceCorrected']);
    expect(t.events[0]!.payload).toMatchObject({ subjectId: 'student-1', status: 'ABSENT', previousStatus: 'PRESENT', reason: 'سُجّل خطأً', actorUserId: TEACHER.userId, actorRole: 'TEACHER' });
  });

  it('the same status again is UNCHANGED: no reason needed, no history, no event', async () => {
    const t = createAttendanceFakes();
    await marked(t);
    const result = await batch(t, [{ studentId: 'student-1', status: 'PRESENT' }]);
    expect(result.results[0]!.outcome).toBe('UNCHANGED');
    expect(t.repo.corrections).toHaveLength(0);
    expect(t.events).toHaveLength(0);
  });

  it('history is append-only: every correction adds an entry and earlier entries never change; the repository has no delete', async () => {
    const t = createAttendanceFakes();
    await marked(t);
    await batch(t, [{ studentId: 'student-1', status: 'ABSENT', reason: 'الأول' }]);
    const first = { ...t.repo.corrections[0]! };
    t.clock.set(at('2026-11-02T16:50:00Z'));
    await batch(t, [{ studentId: 'student-1', status: 'PRESENT', reason: 'الثاني' }]);
    const history = await t.service.listCorrectionsOfSession('session-1');
    expect(history.map((c) => `${c.previousStatus}>${c.newStatus}:${c.reason}`)).toEqual(['PRESENT>ABSENT:الأول', 'ABSENT>PRESENT:الثاني']);
    expect(history[0]).toEqual(first);
    expect(Object.getOwnPropertyNames(Object.getPrototypeOf(t.repo)).filter((n) => /delete|remove|destroy/i.test(n))).toEqual([]);
  });
});

describe('the Teacher\'s own attendance', () => {
  it('checks in as PRESENT through Smart Guard for the session\'s Teacher; again is UNCHANGED', async () => {
    const t = createAttendanceFakes();
    const result = await t.service.checkInTeacher('session-1', TEACHER.userId, { gps: GPS });
    expect(result.results[0]).toMatchObject({ outcome: 'RECORDED', subjectId: TEACHER.teacherId, record: { subjectType: 'TEACHER', status: 'PRESENT', recordedByRole: 'TEACHER' } });
    expect(t.state.guardCalls).toHaveLength(1);
    expect((await t.service.checkInTeacher('session-1', TEACHER.userId, { gps: GPS })).results[0]!.outcome).toBe('UNCHANGED');
  });

  it('the School Manager may record ABSENT (no reason, no GPS, any time); a later check-in is then a correction that needs a reason', async () => {
    const t = createAttendanceFakes();
    t.clock.set(at('2026-11-05T09:00:00Z')); // days later, far from the session window
    const absent = await t.service.setTeacherAttendanceByManager('session-1', MANAGER, { status: 'ABSENT' });
    expect(absent.results[0]).toMatchObject({ outcome: 'RECORDED', subjectId: TEACHER.teacherId, record: { status: 'ABSENT', recordedByRole: 'SCHOOL_MANAGER', recordedBy: MANAGER } });
    expect(t.state.guardCalls).toHaveLength(0);
    await refused(t.service.checkInTeacher('session-1', TEACHER.userId, { gps: GPS }), 'ATTENDANCE_CORRECTION_REASON_REQUIRED');
    const fixed = await t.service.checkInTeacher('session-1', TEACHER.userId, { gps: GPS, reason: 'كان في الحصة' });
    expect(fixed.results[0]!.outcome).toBe('CORRECTED');
    expect(t.repo.corrections[0]).toMatchObject({ subjectType: 'TEACHER', previousStatus: 'ABSENT', newStatus: 'PRESENT', changedByRole: 'TEACHER' });
  });

  it('the School Manager corrects the Teacher with a reason', async () => {
    const t = createAttendanceFakes();
    await t.service.checkInTeacher('session-1', TEACHER.userId, { gps: GPS });
    await refused(t.service.setTeacherAttendanceByManager('session-1', MANAGER, { status: 'ABSENT' }), 'ATTENDANCE_CORRECTION_REASON_REQUIRED');
    const r = await t.service.setTeacherAttendanceByManager('session-1', MANAGER, { status: 'ABSENT', reason: 'لم يحضر' });
    expect(r.results[0]).toMatchObject({ outcome: 'CORRECTED', record: { status: 'ABSENT', updatedByRole: 'SCHOOL_MANAGER' } });
    await refused(t.service.setTeacherAttendanceByManager('session-1', MANAGER, { status: 'LATE' }), 'ATTENDANCE_INVALID_STATUS');
  });
});

describe('the School Manager and students (no GPS, any time)', () => {
  it('records a first marking without a reason, and corrects with one, long after the session', async () => {
    const t = createAttendanceFakes();
    t.clock.set(at('2026-11-09T09:00:00Z'));
    const first = await t.service.setStudentAttendanceByManager('session-1', 'student-2', MANAGER, { status: 'ABSENT' });
    expect(first.results[0]).toMatchObject({ outcome: 'RECORDED', record: { subjectType: 'STUDENT', subjectId: 'student-2', status: 'ABSENT', recordedByRole: 'SCHOOL_MANAGER' } });
    await refused(t.service.setStudentAttendanceByManager('session-1', 'student-2', MANAGER, { status: 'PRESENT' }), 'ATTENDANCE_CORRECTION_REASON_REQUIRED');
    const fixed = await t.service.setStudentAttendanceByManager('session-1', 'student-2', MANAGER, { status: 'PRESENT', reason: 'كان حاضرًا' });
    expect(fixed.results[0]!.outcome).toBe('CORRECTED');
    expect(t.state.guardCalls).toHaveLength(0);
    expect(t.types()).toEqual(['AttendanceRecorded', 'AttendanceCorrected']);
  });

  it('a student without a record must be currently assigned; one who has a record and has since left can still be corrected', async () => {
    const t = createAttendanceFakes();
    t.assigned.set('student-9', ['group-2']);
    await refused(t.service.setStudentAttendanceByManager('session-1', 'student-9', MANAGER, { status: 'PRESENT' }), 'ATTENDANCE_STUDENT_NOT_IN_GROUP');
    await batch(t, present('student-3'));
    t.assigned.set('student-3', []); // left the group afterwards
    const r = await t.service.setStudentAttendanceByManager('session-1', 'student-3', MANAGER, { status: 'ABSENT', reason: 'تصحيح' });
    expect(r.results[0]!.outcome).toBe('CORRECTED');
  });
});

describe('cancelled sessions accept no attendance', () => {
  it('neither the Teacher nor the School Manager', async () => {
    const t = createAttendanceFakes({ session: fakeSession({ status: 'CANCELLED' }) });
    await refused(batch(t, present('student-1')), 'ATTENDANCE_SESSION_CANCELLED');
    await refused(t.service.checkInTeacher('session-1', TEACHER.userId, { gps: GPS }), 'ATTENDANCE_SESSION_CANCELLED');
    await refused(t.service.setTeacherAttendanceByManager('session-1', MANAGER, { status: 'ABSENT' }), 'ATTENDANCE_SESSION_CANCELLED');
    await refused(t.service.setStudentAttendanceByManager('session-1', 'student-1', MANAGER, { status: 'ABSENT' }), 'ATTENDANCE_SESSION_CANCELLED');
    expect(t.repo.rows.size).toBe(0);
  });
});

describe('concurrency: another request inserts the same (session, subject) first', () => {
  it('retries and then sees the existing record: same status is UNCHANGED, a different one needs a reason; exactly one record exists', async () => {
    const t = createAttendanceFakes();
    const repo = t.repo as InMemoryAttendanceRepository & { insertIfAbsent: InMemoryAttendanceRepository['insertIfAbsent'] };
    const original = repo.insertIfAbsent.bind(repo);
    let raced = false;
    repo.insertIfAbsent = async (record, tx) => {
      if (!raced) {
        raced = true;
        const s = record.snapshot;
        await original(AttendanceRecord.rehydrate({ ...s, id: 'winner', status: 'PRESENT', recordedBy: 'someone-else' }), tx); // the competing request wins
        return false;
      }
      return original(record, tx);
    };
    const result = await batch(t, [{ studentId: 'student-1', status: 'PRESENT' }]);
    expect(result.results[0]!.outcome).toBe('UNCHANGED');
    expect(t.repo.rows.size).toBe(1);
    expect([...t.repo.rows.values()][0]!.id).toBe('winner');
  });

  it('gives up with ATTENDANCE_CONCURRENT_CHANGE after 3 attempts and writes nothing of its own', async () => {
    const t = createAttendanceFakes();
    t.repo.insertIfAbsent = async () => false;
    await refused(batch(t, [{ studentId: 'student-1', status: 'PRESENT' }]), 'ATTENDANCE_CONCURRENT_CHANGE');
    expect(t.repo.rows.size).toBe(0);
  });
});

describe('reads', () => {
  it('a session\'s attendance: the session\'s Teacher and the school\'s School Manager only', async () => {
    const t = createAttendanceFakes();
    await t.service.checkInTeacher('session-1', TEACHER.userId, { gps: GPS });
    await batch(t, [{ studentId: 'student-1', status: 'PRESENT' }, { studentId: 'student-2', status: 'ABSENT' }]);
    const asTeacher = await t.service.getSessionAttendance('session-1', TEACHER.userId);
    expect(asTeacher.teacher).toMatchObject({ subjectType: 'TEACHER', status: 'PRESENT' });
    expect(asTeacher.students.map((s) => `${s.subjectId}:${s.status}`)).toEqual(['student-1:PRESENT', 'student-2:ABSENT']);
    expect((await t.service.getSessionAttendance('session-1', MANAGER)).students).toHaveLength(2);
    await refused(t.service.getSessionAttendance('session-1', OTHER_TEACHER.userId), 'ATTENDANCE_READ_NOT_ALLOWED');
    await refused(t.service.getSessionAttendance('session-1', OTHER_USER), 'ATTENDANCE_READ_NOT_ALLOWED');
  });

  it('a student\'s attendance over time: only that student\'s records, newest session first by default, paged with a total', async () => {
    const t = createAttendanceFakes();
    for (const [id, day] of [['s-a', '2026-11-02'], ['s-b', '2026-11-09'], ['s-c', '2026-11-16']] as const) {
      const rec = AttendanceRecord.record({ sessionId: id, schoolId: 'school-1', groupId: 'group-1', subjectType: 'STUDENT', subjectId: 'student-1', status: 'PRESENT', occurrenceDate: day, scheduledStart: at(`${day}T16:00:00Z`), actorUserId: 'u', actorRole: 'TEACHER', clock: t.clock });
      await t.repo.insertIfAbsent(rec, {} as never);
    }
    await batch(t, present('student-2'));
    const page = await t.service.listStudentAttendance('student-1', { page: { page: 1, pageSize: 2 } });
    expect(page.items.map((r) => r.occurrenceDate)).toEqual(['2026-11-16', '2026-11-09']);
    expect(page.total).toBe(3);
    expect((await t.service.listStudentAttendance('student-1', { direction: 'asc', page: { page: 2, pageSize: 2 } })).items.map((r) => r.occurrenceDate)).toEqual(['2026-11-16']);
    expect((await t.service.listStudentAttendance('student-2', { page: { page: 1, pageSize: 10 } })).total).toBe(1);
  });
});

describe('the ONE automatic rule: a Teacher who did not check in by the end of the session, or who cancels it, is ABSENT (recorded by the system)', () => {
  const payload = (over: Record<string, unknown> = {}) => ({ sessionId: 'session-1', schoolId: 'school-1', groupId: 'group-1', teacherId: TEACHER.teacherId, occurrenceDate: '2026-11-02', scheduledStart: '2026-11-02T16:00:00.000Z', ...over });
  const event = (eventType: string, over: Record<string, unknown> = {}) => ({ eventType, payload: payload(over), occurredAt: at('2026-11-02T17:00:00Z') }) as unknown as DomainEvent;
  const handlerOf = (t: ReturnType<typeof createAttendanceFakes>) => createMarkTeacherAbsentOnSessionEndHandler(() => t.service);
  const teacherRecord = (t: ReturnType<typeof createAttendanceFakes>) => [...t.repo.rows.values()].find((r) => r.subjectType === 'TEACHER');

  it('session COMPLETED and no record: the Teacher is ABSENT, recorded by the SYSTEM with AttendanceRecorded', async () => {
    const t = createAttendanceFakes();
    t.clock.set(at('2026-11-02T17:00:00Z'));
    await handlerOf(t).handle(event('ClassSessionCompleted'));
    expect(teacherRecord(t)).toMatchObject({ subjectId: TEACHER.teacherId, status: 'ABSENT', recordedBy: SYSTEM_ACTOR_ID, recordedByRole: 'SYSTEM', updatedByRole: 'SYSTEM', occurrenceDate: '2026-11-02' });
    expect(t.types()).toEqual(['AttendanceRecorded']);
    expect(t.events[0]!.payload).toMatchObject({ subjectType: 'TEACHER', status: 'ABSENT', actorUserId: SYSTEM_ACTOR_ID, actorRole: 'SYSTEM' });
    expect(t.repo.corrections).toHaveLength(0);
  });

  it('is idempotent: the same event delivered twice creates one record and one event', async () => {
    const t = createAttendanceFakes();
    await handlerOf(t).handle(event('ClassSessionCompleted'));
    await handlerOf(t).handle(event('ClassSessionCompleted'));
    expect(t.repo.rows.size).toBe(1);
    expect(t.types()).toEqual(['AttendanceRecorded']);
  });

  it('an existing record is never touched at completion: PRESENT (checked in) and ABSENT (School Manager) both stay', async () => {
    const present = createAttendanceFakes();
    await present.service.checkInTeacher('session-1', TEACHER.userId, { gps: GPS });
    present.events.length = 0;
    await handlerOf(present).handle(event('ClassSessionCompleted'));
    expect(teacherRecord(present)).toMatchObject({ status: 'PRESENT', recordedByRole: 'TEACHER' });
    expect(present.events).toHaveLength(0);
    expect(present.repo.corrections).toHaveLength(0);
    const absent = createAttendanceFakes();
    await absent.service.setTeacherAttendanceByManager('session-1', MANAGER, { status: 'ABSENT' });
    absent.events.length = 0;
    await handlerOf(absent).handle(event('ClassSessionCompleted'));
    expect(teacherRecord(absent)).toMatchObject({ status: 'ABSENT', recordedByRole: 'SCHOOL_MANAGER' });
    expect(absent.events).toHaveLength(0);
  });

  it('the Teacher CANCELS the session: ABSENT is recorded (no record) ...', async () => {
    const t = createAttendanceFakes();
    await handlerOf(t).handle(event('ClassSessionCancelled', { cancelSource: 'TEACHER' }));
    expect(teacherRecord(t)).toMatchObject({ status: 'ABSENT', recordedByRole: 'SYSTEM' });
    await handlerOf(t).handle(event('ClassSessionCancelled', { cancelSource: 'TEACHER' })); // delivered twice
    expect(t.repo.rows.size).toBe(1);
    expect(t.types()).toEqual(['AttendanceRecorded']);
  });

  it('... and a Teacher who had already checked in becomes ABSENT as a SYSTEM correction kept in the append-only history', async () => {
    const t = createAttendanceFakes();
    await t.service.checkInTeacher('session-1', TEACHER.userId, { gps: GPS });
    t.events.length = 0;
    t.clock.set(at('2026-11-02T16:20:00Z'));
    await handlerOf(t).handle(event('ClassSessionCancelled', { cancelSource: 'TEACHER' }));
    expect(teacherRecord(t)).toMatchObject({ status: 'ABSENT', recordedByRole: 'TEACHER', updatedByRole: 'SYSTEM', updatedBy: SYSTEM_ACTOR_ID });
    expect(t.repo.corrections).toHaveLength(1);
    expect(t.repo.corrections[0]).toMatchObject({ subjectType: 'TEACHER', previousStatus: 'PRESENT', newStatus: 'ABSENT', reason: 'SESSION_CANCELLED_BY_TEACHER', changedBy: SYSTEM_ACTOR_ID, changedByRole: 'SYSTEM', changedAt: at('2026-11-02T16:20:00Z') });
    expect(t.types()).toEqual(['AttendanceCorrected']);
    await handlerOf(t).handle(event('ClassSessionCancelled', { cancelSource: 'TEACHER' })); // delivered twice
    expect(t.repo.corrections).toHaveLength(1);
  });

  it('a cancellation by the SYSTEM (retired schedule slot) marks nobody: the Teacher is not at fault', async () => {
    const t = createAttendanceFakes();
    await handlerOf(t).handle(event('ClassSessionCancelled', { cancelSource: 'SCHEDULE_SLOT_RETIRED' }));
    expect(t.repo.rows.size).toBe(0);
    expect(t.events).toHaveLength(0);
  });

  it('STUDENTS are never marked automatically: only the Teacher\'s record exists after completion', async () => {
    const t = createAttendanceFakes();
    await handlerOf(t).handle(event('ClassSessionCompleted'));
    expect([...t.repo.rows.values()].map((r) => r.subjectType)).toEqual(['TEACHER']);
  });

  it('ignores other events and incomplete payloads', async () => {
    const t = createAttendanceFakes();
    await handlerOf(t).handle(event('ClassSessionStarted'));
    await handlerOf(t).handle(event('ClassSessionCreated'));
    await handlerOf(t).handle({ eventType: 'ClassSessionCompleted', payload: { sessionId: 'session-1' }, occurredAt: at('2026-11-02T17:00:00Z') } as unknown as DomainEvent);
    await handlerOf(t).handle({ eventType: 'ClassSessionCompleted', payload: null, occurredAt: at('2026-11-02T17:00:00Z') } as unknown as DomainEvent);
    expect(t.repo.rows.size).toBe(0);
    expect(handlerOf(t).eventTypes).toEqual(['ClassSessionCompleted', 'ClassSessionCancelled']);
  });

  it('after completion the School Manager can still correct the automatic ABSENT to PRESENT (reason required, history kept); after a Teacher cancellation nobody can (no attendance for a cancelled session)', async () => {
    const done = createAttendanceFakes();
    await handlerOf(done).handle(event('ClassSessionCompleted'));
    await refused(done.service.setTeacherAttendanceByManager('session-1', MANAGER, { status: 'PRESENT' }), 'ATTENDANCE_CORRECTION_REASON_REQUIRED');
    const fixed = await done.service.setTeacherAttendanceByManager('session-1', MANAGER, { status: 'PRESENT', reason: 'كان حاضرًا ونسي التسجيل' });
    expect(fixed.results[0]).toMatchObject({ outcome: 'CORRECTED', record: { status: 'PRESENT', updatedByRole: 'SCHOOL_MANAGER' } });
    expect(done.repo.corrections[0]).toMatchObject({ previousStatus: 'ABSENT', newStatus: 'PRESENT', changedByRole: 'SCHOOL_MANAGER' });
    const cancelled = createAttendanceFakes({ session: fakeSession({ status: 'CANCELLED' }) });
    await handlerOf(cancelled).handle(event('ClassSessionCancelled', { cancelSource: 'TEACHER' }));
    expect(teacherRecord(cancelled)).toMatchObject({ status: 'ABSENT' });
    await refused(cancelled.service.setTeacherAttendanceByManager('session-1', MANAGER, { status: 'PRESENT', reason: 'x' }), 'ATTENDANCE_SESSION_CANCELLED');
  });

  it('a racing check-in that wins the insert is respected at completion (retry sees PRESENT) and overridden at a Teacher cancellation', async () => {
    for (const [type, extra, expected] of [['ClassSessionCompleted', {}, 'PRESENT'], ['ClassSessionCancelled', { cancelSource: 'TEACHER' }, 'ABSENT']] as const) {
      const t = createAttendanceFakes();
      const repo = t.repo as InMemoryAttendanceRepository;
      const original = repo.insertIfAbsent.bind(repo);
      let raced = false;
      repo.insertIfAbsent = async (record, tx) => {
        if (!raced) {
          raced = true;
          await original(AttendanceRecord.rehydrate({ ...record.snapshot, id: 'winner', status: 'PRESENT', subjectType: 'TEACHER', recordedBy: TEACHER.userId, recordedByRole: 'TEACHER', updatedBy: TEACHER.userId, updatedByRole: 'TEACHER' }), tx);
          return false;
        }
        return original(record, tx);
      };
      await handlerOf(t).handle(event(type, extra));
      expect(t.repo.rows.size).toBe(1);
      expect(teacherRecord(t)!.status).toBe(expected);
    }
  });
});
