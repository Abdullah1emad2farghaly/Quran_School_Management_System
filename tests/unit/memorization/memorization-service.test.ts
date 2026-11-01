import { describe, expect, it } from 'vitest';
import { GPS, MANAGER, OTHER_TEACHER, OTHER_USER, S1, S2, S3, TEACHER, createMemorizationFakes, range } from '../../helpers/memorization-fakes';

const R_A = range(2, 1, 5); // ayahs 1-5
const R_B = range(2, 6, 5); // ayahs 6-10
const R_C = range(2, 11, 3); // ayahs 11-13
const reject = (promise: Promise<unknown>, code: string) => expect(promise).rejects.toMatchObject({ code });

/** S1 in progress: the Teacher defined `R_A` for the next session; S1 ended; S2 (the next actual session) is in progress. */
async function withAssignmentForS2(mode: 'GROUP' | 'INDIVIDUAL' = 'GROUP', studentId?: string) {
  const f = createMemorizationFakes({ learningMode: mode });
  const assignment = await f.service.defineAssignment(S1, TEACHER.userId, { range: R_A, ...(studentId ? { studentId } : {}) });
  f.endFirstSession();
  f.startSecond();
  return { f, assignment };
}

describe('Memorization assignment: who, when, which group type', () => {
  it('the session\'s Teacher defines the NEXT session\'s assignment during the current session (history + event)', async () => {
    const f = createMemorizationFakes();
    const a = await f.service.defineAssignment(S1, TEACHER.userId, { range: R_A });
    expect(a).toMatchObject({ studentId: null, definedInSessionId: S1, status: 'ACTIVE', groupId: 'group-1' });
    expect(a.range.segments).toEqual([{ surah: 2, firstAyah: 1, lastAyah: 5 }]);
    expect((await f.service.listAssignmentHistoryOfSession(S1)).map((h) => h.action)).toEqual(['DEFINED']);
    expect(f.types()).toEqual(['MemorizationAssignmentDefined']);
    expect(f.state.guardCalls).toHaveLength(0); // defining an assignment is not a GPS action
  });

  it('only the session\'s Teacher: another Teacher and a School Manager are refused', async () => {
    const f = createMemorizationFakes();
    await reject(f.service.defineAssignment(S1, OTHER_TEACHER.userId, { range: R_A }), 'MEMORIZATION_NOT_SESSION_TEACHER');
    await reject(f.service.defineAssignment(S1, MANAGER, { range: R_A }), 'MEMORIZATION_NOT_SESSION_TEACHER');
    expect(f.repo.assignments.size).toBe(0);
  });

  it('only while the current session is IN_PROGRESS (not before, not after it ends)', async () => {
    const f = createMemorizationFakes();
    await reject(f.service.defineAssignment(S2, TEACHER.userId, { range: R_A }), 'MEMORIZATION_ASSIGNMENT_WINDOW_CLOSED'); // OPEN
    f.endFirstSession();
    await reject(f.service.defineAssignment(S1, TEACHER.userId, { range: R_A }), 'MEMORIZATION_ASSIGNMENT_WINDOW_CLOSED'); // COMPLETED
    const g = createMemorizationFakes();
    g.clock.set(new Date(Date.UTC(2026, 10, 2, 17, 0, 0))); // the scheduler has not yet marked it COMPLETED, but the scheduled end is reached
    await reject(g.service.defineAssignment(S1, TEACHER.userId, { range: R_A }), 'MEMORIZATION_ASSIGNMENT_WINDOW_CLOSED');
  });

  it('GROUP mode (collective): ONE shared assignment, never one for an individual student', async () => {
    const f = createMemorizationFakes({ learningMode: 'GROUP' });
    await reject(f.service.defineAssignment(S1, TEACHER.userId, { range: R_A, studentId: 'student-1' }), 'MEMORIZATION_GROUP_ASSIGNMENT_NO_STUDENT');
    await f.service.defineAssignment(S1, TEACHER.userId, { range: R_A });
    await reject(f.service.defineAssignment(S1, TEACHER.userId, { range: R_B }), 'MEMORIZATION_ASSIGNMENT_ALREADY_DEFINED');
  });

  it('INDIVIDUAL mode: one independent assignment per student, different ranges allowed; the student is required and must be in the group', async () => {
    const f = createMemorizationFakes({ learningMode: 'INDIVIDUAL' });
    await reject(f.service.defineAssignment(S1, TEACHER.userId, { range: R_A }), 'MEMORIZATION_STUDENT_REQUIRED');
    await reject(f.service.defineAssignment(S1, TEACHER.userId, { range: R_A, studentId: 'student-9' }), 'MEMORIZATION_STUDENT_NOT_IN_GROUP');
    const one = await f.service.defineAssignment(S1, TEACHER.userId, { range: R_A, studentId: 'student-1' });
    const two = await f.service.defineAssignment(S1, TEACHER.userId, { range: R_B, studentId: 'student-2' });
    expect(one.studentId).toBe('student-1');
    expect(two.range.first.ayah).toBe(6);
    await reject(f.service.defineAssignment(S1, TEACHER.userId, { range: R_C, studentId: 'student-1' }), 'MEMORIZATION_ASSIGNMENT_ALREADY_DEFINED');
  });

  it('the range comes from Module 22: an invalid range or a missing range is refused', async () => {
    const f = createMemorizationFakes();
    await reject(f.service.defineAssignment(S1, TEACHER.userId, { range: undefined }), 'MEMORIZATION_RANGE_REQUIRED');
    await reject(f.service.defineAssignment(S1, TEACHER.userId, { range: { start: { surah: 2 }, unit: 'AYAHS', amount: 5, direction: 'FORWARD' } }), 'QURAN_RANGE_START_INVALID');
    await reject(f.service.defineAssignment(S1, TEACHER.userId, { range: range(2, 285, 5) }), 'QURAN_RANGE_EXCEEDS_QURAN');
  });
});

describe('Modifying and cancelling an assignment (only during its defining session; history kept)', () => {
  it('modify keeps the previous range in the append-only history; cancel keeps the assignment as CANCELLED and frees the slot', async () => {
    const f = createMemorizationFakes();
    const a = await f.service.defineAssignment(S1, TEACHER.userId, { range: R_A });
    const m = await f.service.modifyAssignment(a.id, TEACHER.userId, { range: R_B });
    expect(m.range.first.ayah).toBe(6);
    const c = await f.service.cancelAssignment(a.id, TEACHER.userId);
    expect(c.status).toBe('CANCELLED');
    const history = await f.service.listAssignmentHistoryOfSession(S1);
    expect(history.map((h) => h.action)).toEqual(['DEFINED', 'MODIFIED', 'CANCELLED']);
    expect(history[1]!.previousRange!.first.ayah).toBe(1);
    expect(history[1]!.newRange!.first.ayah).toBe(6);
    expect(f.repo.assignments.size).toBe(1); // never deleted
    await reject(f.service.modifyAssignment(a.id, TEACHER.userId, { range: R_C }), 'MEMORIZATION_ASSIGNMENT_CANCELLED');
    await f.service.defineAssignment(S1, TEACHER.userId, { range: R_C }); // a new one after the cancellation
    expect(f.types()).toEqual(['MemorizationAssignmentDefined', 'MemorizationAssignmentModified', 'MemorizationAssignmentCancelled', 'MemorizationAssignmentDefined']);
  });

  it('once the current session has ended the assignment is final and immutable', async () => {
    const f = createMemorizationFakes();
    const a = await f.service.defineAssignment(S1, TEACHER.userId, { range: R_A });
    f.endFirstSession();
    await reject(f.service.modifyAssignment(a.id, TEACHER.userId, { range: R_B }), 'MEMORIZATION_ASSIGNMENT_WINDOW_CLOSED');
    await reject(f.service.cancelAssignment(a.id, TEACHER.userId), 'MEMORIZATION_ASSIGNMENT_WINDOW_CLOSED');
    expect((await f.repo.findAssignment(a.id))!.snapshot.range.first.ayah).toBe(1);
    expect((await f.service.listAssignmentHistoryOfSession(S1)).map((h) => h.action)).toEqual(['DEFINED']);
  });

  it('only the session\'s Teacher; unknown assignment is not found', async () => {
    const f = createMemorizationFakes();
    const a = await f.service.defineAssignment(S1, TEACHER.userId, { range: R_A });
    await reject(f.service.modifyAssignment(a.id, OTHER_TEACHER.userId, { range: R_B }), 'MEMORIZATION_NOT_SESSION_TEACHER');
    await reject(f.service.cancelAssignment(a.id, MANAGER), 'MEMORIZATION_NOT_SESSION_TEACHER');
    await reject(f.service.cancelAssignment('00000000-0000-4000-8000-000000000000', TEACHER.userId), 'MEMORIZATION_ASSIGNMENT_NOT_FOUND');
  });
});

describe('Scheduled memorization and continuity (for the half-session reminder)', () => {
  it('memorization is scheduled only when explicitly defined before the session starts; no session is assumed to include it', async () => {
    const f = createMemorizationFakes();
    expect((await f.service.getScheduledMemorization(S1)).scheduled).toBe(false); // nothing was defined for the first session
    expect((await f.service.getScheduledMemorization(S2)).scheduled).toBe(false); // defined nowhere yet
    await f.service.defineAssignment(S1, TEACHER.userId, { range: R_A });
    f.endFirstSession();
    const s2 = await f.service.getScheduledMemorization(S2);
    expect(s2).toMatchObject({ scheduled: true, groupId: 'group-1', teacherId: 'teacher-1' });
    expect(s2.assignments[0]!.range.first.ayah).toBe(1);
    expect((await f.service.getScheduledMemorization(S1)).scheduled).toBe(false); // never for the session it was defined in
    expect(s2.records).toEqual([]);
    expect(s2.unrecordedAssignmentIds).toEqual([s2.assignments[0]!.id]);
  });

  it('a cancelled target session keeps the assignment for the next actual session, unchanged', async () => {
    const f = createMemorizationFakes();
    const a = await f.service.defineAssignment(S1, TEACHER.userId, { range: R_A });
    f.endFirstSession();
    f.setStatus(S2, 'CANCELLED');
    const s3 = await f.service.getScheduledMemorization(S3);
    expect(s3.assignments.map((x) => x.id)).toEqual([a.id]);
    expect(s3.assignments[0]!.range).toEqual(a.range);
  });

  it('a rescheduled target session carries the assignment according to the updated schedule', async () => {
    const f = createMemorizationFakes();
    const a = await f.service.defineAssignment(S1, TEACHER.userId, { range: R_A });
    f.endFirstSession();
    f.reschedule(S2, 11);
    expect((await f.service.getScheduledMemorization(S2)).assignments.map((x) => x.id)).toEqual([a.id]);
    expect((await f.service.getScheduledMemorization(S3)).assignments.map((x) => x.id)).toEqual([a.id]); // still pending for the following session
  });

  it('the Teacher absent from the target session: the assignment moves unchanged to the next actual session', async () => {
    const { f, assignment } = await withAssignmentForS2();
    f.endSecond(); // the Teacher never recorded anything (absent): nothing fulfilled, nothing replaced
    const s3 = await f.service.getScheduledMemorization(S3);
    expect(s3.assignments.map((x) => x.id)).toEqual([assignment.id]);
    expect(s3.assignments[0]!.range).toEqual(assignment.range);
    expect(f.repo.records.size).toBe(0); // nothing was fabricated
  });

  it('once fulfilled it is no longer scheduled for later sessions, but the past session keeps showing it as scheduled (stable history)', async () => {
    const { f, assignment } = await withAssignmentForS2();
    await f.service.recordMemorization(S2, TEACHER.userId, { gps: GPS, records: [{ studentId: 'student-1', range: R_A }] });
    f.endSecond();
    expect((await f.service.getScheduledMemorization(S3)).scheduled).toBe(false);
    const past = await f.service.getScheduledMemorization(S2);
    expect(past.assignments.map((x) => x.id)).toEqual([assignment.id]);
    expect(past.unrecordedAssignmentIds).toEqual([]); // records exist: nothing to remind about
    expect(past.studentsWithRecords).toEqual(['student-1']);
  });

  it('a newer assignment replaces the older one for the following session', async () => {
    const { f } = await withAssignmentForS2();
    await f.service.recordMemorization(S2, TEACHER.userId, { gps: GPS, records: [{ studentId: 'student-1', range: R_A }] });
    const next = await f.service.defineAssignment(S2, TEACHER.userId, { range: R_B });
    f.endSecond();
    expect((await f.service.getScheduledMemorization(S3)).assignments.map((x) => x.id)).toEqual([next.id]);
  });

  it('an assignment defined during a session is never scheduled for that same session', async () => {
    const { f } = await withAssignmentForS2();
    await f.service.defineAssignment(S2, TEACHER.userId, { range: R_B });
    const s2 = await f.service.getScheduledMemorization(S2);
    expect(s2.assignments).toHaveLength(1);
    expect(s2.assignments[0]!.range.first.ayah).toBe(1);
  });
});

describe('Recording memorization (assigned Teacher, Smart Guard)', () => {
  it('goes through Smart Guard with the GPS; a refusal records nothing', async () => {
    const f = createMemorizationFakes();
    await f.service.recordMemorization(S1, TEACHER.userId, { gps: GPS, records: [{ studentId: 'student-1', range: R_A }] });
    expect(f.state.guardCalls).toEqual([{ teacherId: 'teacher-1', sessionId: S1, gps: GPS }]);
    f.state.guardRejects = Object.assign(new Error('SMART_GUARD_OUTSIDE_SCHOOL_GEOFENCE'), { code: 'SMART_GUARD_OUTSIDE_SCHOOL_GEOFENCE' });
    await reject(f.service.recordMemorization(S1, TEACHER.userId, { gps: GPS, records: [{ studentId: 'student-2', range: R_A }] }), 'SMART_GUARD_OUTSIDE_SCHOOL_GEOFENCE');
    expect(f.repo.records.size).toBe(1);
  });

  it('a School Manager (or any non-Teacher) cannot record', async () => {
    const f = createMemorizationFakes();
    await reject(f.service.recordMemorization(S1, MANAGER, { gps: GPS, records: [{ studentId: 'student-1', range: R_A }] }), 'SMART_GUARD_NOT_SESSION_TEACHER');
    await reject(f.service.recordMemorization(S1, OTHER_USER, { gps: GPS, records: [{ studentId: 'student-1', range: R_A }] }), 'SMART_GUARD_NOT_SESSION_TEACHER');
    expect(f.repo.records.size).toBe(0);
    expect(f.state.guardCalls).toHaveLength(0);
  });

  it('is one atomic batch: any invalid item (student outside the group, invalid range) rejects all', async () => {
    const f = createMemorizationFakes();
    await reject(f.service.recordMemorization(S1, TEACHER.userId, { gps: GPS, records: [{ studentId: 'student-1', range: R_A }, { studentId: 'student-9', range: R_A }] }), 'MEMORIZATION_STUDENT_NOT_IN_GROUP');
    await reject(f.service.recordMemorization(S1, TEACHER.userId, { gps: GPS, records: [{ studentId: 'student-1', range: R_A }, { studentId: 'student-2', range: { start: { surah: 2 } } }] }), 'QURAN_RANGE_START_INVALID');
    await reject(f.service.recordMemorization(S1, TEACHER.userId, { gps: GPS, records: [] }), 'MEMORIZATION_RECORDS_REQUIRED');
    await reject(f.service.recordMemorization(S1, TEACHER.userId, { gps: GPS, records: [{ range: R_A }] }), 'MEMORIZATION_INVALID_RECORD');
    expect(f.repo.records.size).toBe(0);
  });

  it('a cancelled session accepts no memorization', async () => {
    const f = createMemorizationFakes();
    f.setStatus(S1, 'CANCELLED');
    await reject(f.service.recordMemorization(S1, TEACHER.userId, { gps: GPS, records: [{ studentId: 'student-1', range: R_A }] }), 'MEMORIZATION_SESSION_CANCELLED');
  });

  it('overlapping ranges are valid; every record is independent and nothing is overwritten', async () => {
    const f = createMemorizationFakes();
    const first = await f.service.recordMemorization(S1, TEACHER.userId, { gps: GPS, records: [{ studentId: 'student-1', range: R_A }] });
    const second = await f.service.recordMemorization(S1, TEACHER.userId, { gps: GPS, records: [{ studentId: 'student-1', range: range(2, 3, 5) }, { studentId: 'student-1', range: R_A }] });
    expect(f.repo.records.size).toBe(3);
    expect(first.results[0]!.record.matchesAssignment).toBeNull(); // nothing was scheduled
    const ids = new Set([first.results[0]!.record.id, ...second.results.map((r) => r.record.id)]);
    expect(ids.size).toBe(3);
    expect((await f.repo.findRecord(first.results[0]!.record.id))!.snapshot.range.first.ayah).toBe(1); // untouched
    expect(f.types().filter((t) => t === 'MemorizationRecorded')).toHaveLength(3);
  });

  it('the same verses again in a LATER session is allowed too', async () => {
    const { f } = await withAssignmentForS2();
    await f.service.recordMemorization(S2, TEACHER.userId, { gps: GPS, records: [{ studentId: 'student-1', range: R_A }] });
    f.endSecond();
    f.startThird();
    await f.service.recordMemorization(S3, TEACHER.userId, { gps: GPS, records: [{ studentId: 'student-1', range: R_A }] });
    expect(f.repo.records.size).toBe(2);
  });
});

describe('Evaluation against the assignment', () => {
  it('only exactly the assigned range fulfils it; a different range is recorded but is NOT fulfilment and the assignment stays pending', async () => {
    const { f, assignment } = await withAssignmentForS2();
    const wrong = await f.service.recordMemorization(S2, TEACHER.userId, { gps: GPS, records: [{ studentId: 'student-1', range: range(2, 1, 3) }] });
    expect(wrong.results[0]!.record).toMatchObject({ assignmentId: assignment.id, matchesAssignment: false });
    f.endSecond();
    expect((await f.service.getScheduledMemorization(S3)).assignments.map((x) => x.id)).toEqual([assignment.id]); // the ENTIRE original assignment is repeated
    expect((await f.service.getScheduledMemorization(S3)).assignments[0]!.range.ayahCount).toBe(5);
  });

  it('the same ayahs produced by another request (e.g. backward) still count as the assigned range', async () => {
    const { f, assignment } = await withAssignmentForS2();
    const ok = await f.service.recordMemorization(S2, TEACHER.userId, { gps: GPS, records: [{ studentId: 'student-1', range: range(2, 5, 5, 'BACKWARD') }] });
    expect(ok.results[0]!.record).toMatchObject({ assignmentId: assignment.id, matchesAssignment: true });
  });

  it('INDIVIDUAL: each student is evaluated against their own assignment', async () => {
    const f = createMemorizationFakes({ learningMode: 'INDIVIDUAL' });
    const a1 = await f.service.defineAssignment(S1, TEACHER.userId, { range: R_A, studentId: 'student-1' });
    const a2 = await f.service.defineAssignment(S1, TEACHER.userId, { range: R_B, studentId: 'student-2' });
    f.endFirstSession();
    f.startSecond();
    const r = await f.service.recordMemorization(S2, TEACHER.userId, { gps: GPS, records: [{ studentId: 'student-1', range: R_A }, { studentId: 'student-2', range: R_A }, { studentId: 'student-3', range: R_A }] });
    expect(r.results.map((x) => [x.record.assignmentId, x.record.matchesAssignment])).toEqual([[a1.id, true], [a2.id, false], [null, null]]);
  });

  it('INDIVIDUAL: the student who did not fulfil it must repeat the ENTIRE original assignment (a different next assignment is refused)', async () => {
    const f = createMemorizationFakes({ learningMode: 'INDIVIDUAL' });
    await f.service.defineAssignment(S1, TEACHER.userId, { range: R_A, studentId: 'student-1' });
    f.endFirstSession();
    f.startSecond();
    await f.service.recordMemorization(S2, TEACHER.userId, { gps: GPS, records: [{ studentId: 'student-1', range: range(2, 1, 2) }] }); // only part of it
    await reject(f.service.defineAssignment(S2, TEACHER.userId, { range: range(2, 3, 3), studentId: 'student-1' }), 'MEMORIZATION_REPEAT_REQUIRED'); // only the unfinished part
    await reject(f.service.defineAssignment(S2, TEACHER.userId, { range: R_B, studentId: 'student-1' }), 'MEMORIZATION_REPEAT_REQUIRED');
    const repeat = await f.service.defineAssignment(S2, TEACHER.userId, { range: R_A, studentId: 'student-1' }); // the whole original
    expect(repeat.range.ayahCount).toBe(5);
  });

  it('INDIVIDUAL: a next assignment defined BEFORE a non-fulfilling record blocks that record until it matches the original or is cancelled', async () => {
    const f = createMemorizationFakes({ learningMode: 'INDIVIDUAL' });
    await f.service.defineAssignment(S1, TEACHER.userId, { range: R_A, studentId: 'student-1' });
    f.endFirstSession();
    f.startSecond();
    const next = await f.service.defineAssignment(S2, TEACHER.userId, { range: R_B, studentId: 'student-1' });
    await reject(f.service.recordMemorization(S2, TEACHER.userId, { gps: GPS, records: [{ studentId: 'student-1', range: range(2, 1, 2) }] }), 'MEMORIZATION_RECORD_CONFLICTS_WITH_NEXT_ASSIGNMENT');
    expect(f.repo.records.size).toBe(0);
    await f.service.recordMemorization(S2, TEACHER.userId, { gps: GPS, records: [{ studentId: 'student-1', range: R_A }] }); // fulfilling is fine
    await f.service.modifyAssignment(next.id, TEACHER.userId, { range: R_A }); // or make the next one the original
    await f.service.cancelAssignment(next.id, TEACHER.userId);
  });

  it('GROUP (collective): the Teacher may repeat the same assignment or define a new shared one, even if a student did not fulfil it', async () => {
    const { f } = await withAssignmentForS2('GROUP');
    await f.service.recordMemorization(S2, TEACHER.userId, { gps: GPS, records: [{ studentId: 'student-1', range: range(2, 1, 2) }, { studentId: 'student-2', range: R_A }] });
    const fresh = await f.service.defineAssignment(S2, TEACHER.userId, { range: R_B });
    expect(fresh.studentId).toBeNull();
    f.endSecond();
    expect((await f.service.getScheduledMemorization(S3)).assignments.map((x) => x.id)).toEqual([fresh.id]);
  });
});

describe('Correcting a record (assigned Teacher, same session only; the original is kept)', () => {
  it('during the same session: Smart Guard, the original and the correction stay in the append-only history, matches is recomputed', async () => {
    const { f, assignment } = await withAssignmentForS2();
    const recorded = await f.service.recordMemorization(S2, TEACHER.userId, { gps: GPS, records: [{ studentId: 'student-1', range: range(2, 1, 3) }] });
    const id = recorded.results[0]!.record.id;
    expect(recorded.results[0]!.record.matchesAssignment).toBe(false);
    const fixed = await f.service.correctRecord(id, TEACHER.userId, { gps: GPS, range: R_A, reason: '  سبق قلم  ' });
    expect(fixed.outcome).toBe('CORRECTED');
    expect(fixed.record).toMatchObject({ assignmentId: assignment.id, matchesAssignment: true });
    const history = await f.service.listCorrectionsOfSession(S2);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ recordId: id, previousMatches: false, newMatches: true, reason: 'سبق قلم', changedBy: TEACHER.userId });
    expect(history[0]!.previousRange.ayahCount).toBe(3); // the ORIGINAL is preserved
    expect(history[0]!.newRange.ayahCount).toBe(5);
    expect(f.state.guardCalls.at(-1)).toEqual({ teacherId: 'teacher-1', sessionId: S2, gps: GPS });
    expect(f.types()).toContain('MemorizationRecordCorrected');
    expect(f.repo.records.size).toBe(1); // never deleted or duplicated
  });

  it('the same ayahs again change nothing (no history, no event)', async () => {
    const f = createMemorizationFakes();
    const r = await f.service.recordMemorization(S1, TEACHER.userId, { gps: GPS, records: [{ studentId: 'student-1', range: R_A }] });
    const before = f.events.length;
    const out = await f.service.correctRecord(r.results[0]!.record.id, TEACHER.userId, { gps: GPS, range: range(2, 5, 5, 'BACKWARD') });
    expect(out.outcome).toBe('UNCHANGED');
    expect(f.events).toHaveLength(before);
    expect(await f.service.listCorrectionsOfSession(S1)).toEqual([]);
  });

  it('after the session ends the record is immutable', async () => {
    const f = createMemorizationFakes();
    const r = await f.service.recordMemorization(S1, TEACHER.userId, { gps: GPS, records: [{ studentId: 'student-1', range: R_A }] });
    f.endFirstSession();
    await reject(f.service.correctRecord(r.results[0]!.record.id, TEACHER.userId, { gps: GPS, range: R_B }), 'MEMORIZATION_CORRECTION_WINDOW_CLOSED');
    expect((await f.repo.findRecord(r.results[0]!.record.id))!.snapshot.range.first.ayah).toBe(1);
    expect(await f.service.listCorrectionsOfSession(S1)).toEqual([]);
  });

  it('a School Manager (or another Teacher) cannot correct', async () => {
    const f = createMemorizationFakes();
    const r = await f.service.recordMemorization(S1, TEACHER.userId, { gps: GPS, records: [{ studentId: 'student-1', range: R_A }] });
    await reject(f.service.correctRecord(r.results[0]!.record.id, MANAGER, { gps: GPS, range: R_B }), 'SMART_GUARD_NOT_SESSION_TEACHER');
    await reject(f.service.correctRecord('00000000-0000-4000-8000-000000000000', TEACHER.userId, { gps: GPS, range: R_B }), 'MEMORIZATION_RECORD_NOT_FOUND');
    await reject(f.service.correctRecord(r.results[0]!.record.id, TEACHER.userId, { gps: GPS, range: R_B, reason: 'x'.repeat(501) }), 'MEMORIZATION_REASON_TOO_LONG');
  });

  it('INDIVIDUAL: a correction that stops fulfilling the assignment cannot leave a different next assignment', async () => {
    const f = createMemorizationFakes({ learningMode: 'INDIVIDUAL' });
    await f.service.defineAssignment(S1, TEACHER.userId, { range: R_A, studentId: 'student-1' });
    f.endFirstSession();
    f.startSecond();
    const r = await f.service.recordMemorization(S2, TEACHER.userId, { gps: GPS, records: [{ studentId: 'student-1', range: R_A }] });
    await f.service.defineAssignment(S2, TEACHER.userId, { range: R_B, studentId: 'student-1' });
    await reject(f.service.correctRecord(r.results[0]!.record.id, TEACHER.userId, { gps: GPS, range: range(2, 1, 2) }), 'MEMORIZATION_RECORD_CONFLICTS_WITH_NEXT_ASSIGNMENT');
    expect((await f.repo.findRecord(r.results[0]!.record.id))!.snapshot.matchesAssignment).toBe(true);
  });
});

describe('Read permissions (route guards add role and scope; the service adds relationship)', () => {
  it('the session\'s Teacher and the School Manager of its school read a session; others do not', async () => {
    const { f, assignment } = await withAssignmentForS2();
    await f.service.recordMemorization(S2, TEACHER.userId, { gps: GPS, records: [{ studentId: 'student-1', range: R_A }] });
    const next = await f.service.defineAssignment(S2, TEACHER.userId, { range: R_B });
    for (const userId of [TEACHER.userId, MANAGER]) {
      const view = await f.service.getSessionMemorization(S2, userId);
      expect(view.scheduled.map((a) => a.id)).toEqual([assignment.id]);
      expect(view.defined.map((a) => a.id)).toEqual([next.id]);
      expect(view.records).toHaveLength(1);
    }
    await reject(f.service.getSessionMemorization(S2, OTHER_TEACHER.userId), 'MEMORIZATION_READ_NOT_ALLOWED');
    await reject(f.service.getSessionMemorization(S2, OTHER_USER), 'MEMORIZATION_READ_NOT_ALLOWED');
  });

  it('a student\'s records are paginated, newest session first', async () => {
    const { f } = await withAssignmentForS2();
    await f.service.recordMemorization(S2, TEACHER.userId, { gps: GPS, records: [{ studentId: 'student-1', range: R_A }] });
    f.endSecond();
    f.startThird();
    await f.service.recordMemorization(S3, TEACHER.userId, { gps: GPS, records: [{ studentId: 'student-1', range: R_B }] });
    const page = await f.service.listStudentRecords('student-1', { page: { page: 1, pageSize: 1 } } as never);
    expect(page.items.map((r) => r.sessionId)).toEqual([S3]);
    expect(page.total).toBe(2);
  });
});
