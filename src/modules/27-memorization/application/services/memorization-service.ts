import { SystemClock, buildPageResult, type Clock, type PageRequest, type PageResult, type TransactionContext, type UnitOfWork } from '../../../00-shared-kernel/public';
import type { OutboxService } from '../../../06-domain-events-outbox/public';
import type { SchoolLookup } from '../../../16-schools/public';
import type { TeacherLookup } from '../../../18-teachers/public';
import type { GroupService } from '../../../20-groups/public';
import type { QuranRangeEngine } from '../../../22-quran-range-engine/public';
import type { ClassSessionDto, ClassSessionService } from '../../../24-sessions/public';
import { smartGuardError, type SmartGuard } from '../../../25-smart-guard/public';
import { MemorizationAssignment, subjectKeyOf } from '../../domain/entities/memorization-assignment';
import type { AssignmentHistoryEntry } from '../../domain/entities/memorization-assignment';
import { MemorizationRecord, type MemorizationCorrection } from '../../domain/entities/memorization-record';
import { memorizationError } from '../../domain/errors/memorization-errors';
import { MAX_BATCH_RECORDS, sameQuranRange, toMemorizationRange, type MemorizationRange } from '../../domain/value-objects/memorization-range';
import {
  toAssignmentDto, toRecordDto, type AssignmentDto, type RecordBatchResultDto, type RecordCorrectionResultDto, type RecordDto, type ScheduledMemorizationDto, type SessionMemorizationDto,
} from '../dto/memorization-dto';
import type { MemorizationRepository } from '../ports/memorization-repository';

export interface MemorizationServiceDeps {
  readonly memorization: MemorizationRepository;
  /** Module 24: the session (times, school, group, Teacher, status). */
  readonly sessions: Pick<ClassSessionService, 'getSession' | 'findGroupIdOf'>;
  /** Module 25: recording and correcting go through it (GPS, time window, ownership, session not cancelled). */
  readonly smartGuard: Pick<SmartGuard, 'check'>;
  readonly teachers: Pick<TeacherLookup, 'findByUserId'>;
  /** Module 20: the group's learning mode (GROUP = collective, INDIVIDUAL) and who is currently assigned. */
  readonly groups: Pick<GroupService, 'getGroup' | 'listAssignmentHistoryOfStudent'>;
  readonly schools: Pick<SchoolLookup, 'isSchoolManager'>;
  /** Module 22: the ONLY place a range is validated and calculated. */
  readonly ranges: Pick<QuranRangeEngine, 'calculate'>;
  readonly unitOfWork: UnitOfWork;
  readonly outbox: OutboxService;
  readonly clock?: Clock;
}

export interface GpsInput {
  readonly gps: unknown;
}
export interface DefineAssignmentInput {
  /** INDIVIDUAL group: the student. GROUP-mode group: must be absent. */
  readonly studentId?: unknown;
  /** `{ start: { surah, ayah? }, unit, amount, direction }` (Module 22). */
  readonly range: unknown;
}
export interface RecordMemorizationInput extends GpsInput {
  /** `[{ studentId, range }]`. */
  readonly records: unknown;
}
export interface CorrectRecordInput extends GpsInput {
  readonly range: unknown;
  /** Optional (not required by the approved decisions). */
  readonly reason?: unknown;
}
export interface StudentRecordsInput {
  readonly direction?: 'asc' | 'desc';
  readonly page: PageRequest;
}

interface RecordSummary {
  readonly assignmentId: string | null;
  readonly matches: boolean | null;
}

/**
 * Public application contract of Module 27 (Memorization, Master Specification §48) and the approved Module 27 decisions of the project owner.
 *
 *  - ASSIGNMENT. The session's Teacher defines the assignment of the NEXT session DURING the current one; modifying or cancelling it is possible only while the current
 *    session is IN_PROGRESS, after that it is final and immutable. Changes are kept in an append-only history. GROUP-mode (collective) group: ONE shared assignment, never one
 *    per student. INDIVIDUAL group: one independent assignment per student. The assignment belongs to the group/student, not to a session, so it stays available for the next
 *    ACTUAL session: a cancelled, rescheduled or Teacher-absent session never discards or alters it.
 *  - EVALUATION. A record is evaluated against the assignment in effect for the student; `matchesAssignment` is computed from the ranges (never sent by a client): only exactly
 *    the assigned range fulfils it. An unfulfilled assignment stays pending in full (the ENTIRE original assignment is repeated, never only the unfinished part): in an
 *    INDIVIDUAL group the Teacher cannot define a different next assignment for a student who did not fulfil it.
 *  - RECORDING. Only the assigned Teacher, through Smart Guard (GPS), in one atomic batch. A School Manager cannot record or correct. Overlapping ranges are valid and every
 *    record is independent. Nothing is ever deleted.
 *  - CORRECTION. Only the session's Teacher, through Smart Guard, only while that session is in progress; the original is kept in an append-only history.
 *  - READS. For the reminder of §63: `getScheduledMemorization(sessionId)` (public, no user): what is scheduled for a session and which records exist. Nothing is notified here.
 * Route guards authorize first (roles, permissions, scope); this service adds ownership, the session window and the business rules.
 */
export class MemorizationService {
  private readonly repo: MemorizationRepository;
  private readonly sessions: MemorizationServiceDeps['sessions'];
  private readonly smartGuard: MemorizationServiceDeps['smartGuard'];
  private readonly teachers: MemorizationServiceDeps['teachers'];
  private readonly groups: MemorizationServiceDeps['groups'];
  private readonly schools: MemorizationServiceDeps['schools'];
  private readonly ranges: MemorizationServiceDeps['ranges'];
  private readonly unitOfWork: UnitOfWork;
  private readonly outbox: OutboxService;
  private readonly clock: Clock;

  constructor(deps: MemorizationServiceDeps) {
    this.repo = deps.memorization;
    this.sessions = deps.sessions;
    this.smartGuard = deps.smartGuard;
    this.teachers = deps.teachers;
    this.groups = deps.groups;
    this.schools = deps.schools;
    this.ranges = deps.ranges;
    this.unitOfWork = deps.unitOfWork;
    this.outbox = deps.outbox;
    this.clock = deps.clock ?? new SystemClock();
  }

  // ------------------------------------------------------------------------------------------ assignments (the session's Teacher, during the session)

  /** Defines the assignment of the next session during the current (IN_PROGRESS) session. */
  async defineAssignment(sessionId: string, userId: string, input: DefineAssignmentInput): Promise<AssignmentDto> {
    const session = await this.sessions.getSession(sessionId);
    const teacherId = await this.requireSessionTeacher(userId, session);
    this.assertInProgress(session, 'MEMORIZATION_ASSIGNMENT_WINDOW_CLOSED');
    const group = await this.groups.getGroup(session.groupId);
    const studentId = this.parseSubject(group.learningMode, input.studentId);
    if (studentId !== null) await this.assertCurrentlyAssigned(session.groupId, [studentId]);
    const range = await this.calculate(input.range);
    return this.unitOfWork.run(async (tx) => {
      const locked = await this.repo.lockAssignmentsDefinedInSession(session.id, tx);
      if (locked.some((a) => a.snapshot.status === 'ACTIVE' && a.snapshot.studentId === studentId)) throw memorizationError('MEMORIZATION_ASSIGNMENT_ALREADY_DEFINED');
      if (studentId !== null) await this.assertRepeatRespected(session.id, studentId, range, tx);
      const { assignment, history } = MemorizationAssignment.define({
        schoolId: session.schoolId, groupId: session.groupId, studentId, definedInSessionId: session.id, teacherId, actorUserId: userId, range, clock: this.clock,
      });
      if (!(await this.repo.insertAssignment(assignment, history, tx))) throw memorizationError('MEMORIZATION_ASSIGNMENT_ALREADY_DEFINED');
      await this.outbox.publishFrom(assignment, tx);
      return toAssignmentDto(assignment);
    });
  }

  /** Changes the range of an assignment, while its defining session is still in progress. */
  async modifyAssignment(assignmentId: string, userId: string, input: { readonly range: unknown }): Promise<AssignmentDto> {
    const range = await this.calculate(input.range);
    return this.changeAssignment(assignmentId, userId, async (assignment, session, tx) => {
      if (assignment.snapshot.studentId !== null) await this.assertRepeatRespected(session.id, assignment.snapshot.studentId, range, tx);
      const entry = assignment.modify({ range, actorUserId: userId, clock: this.clock });
      return entry;
    });
  }

  /** Cancels an assignment, while its defining session is still in progress. It is kept (status CANCELLED) with its history; nothing is deleted. */
  async cancelAssignment(assignmentId: string, userId: string): Promise<AssignmentDto> {
    return this.changeAssignment(assignmentId, userId, async (assignment) => assignment.cancel({ actorUserId: userId, clock: this.clock }));
  }

  private async changeAssignment(
    assignmentId: string,
    userId: string,
    change: (assignment: MemorizationAssignment, session: ClassSessionDto, tx: TransactionContext) => Promise<AssignmentHistoryEntry>,
  ): Promise<AssignmentDto> {
    const existing = await this.repo.findAssignment(assignmentId);
    if (!existing) throw memorizationError('MEMORIZATION_ASSIGNMENT_NOT_FOUND');
    const session = await this.sessions.getSession(existing.snapshot.definedInSessionId);
    await this.requireSessionTeacher(userId, session);
    this.assertInProgress(session, 'MEMORIZATION_ASSIGNMENT_WINDOW_CLOSED');
    return this.unitOfWork.run(async (tx) => {
      const assignment = await this.repo.lockAssignment(assignmentId, tx);
      if (!assignment) throw memorizationError('MEMORIZATION_ASSIGNMENT_NOT_FOUND');
      if (assignment.snapshot.status === 'CANCELLED') throw memorizationError('MEMORIZATION_ASSIGNMENT_CANCELLED');
      this.assertInProgress(session, 'MEMORIZATION_ASSIGNMENT_WINDOW_CLOSED');
      const entry = await change(assignment, session, tx);
      await this.repo.applyAssignmentChange(assignment, entry, tx);
      await this.outbox.publishFrom(assignment, tx);
      return toAssignmentDto(assignment);
    });
  }

  // ------------------------------------------------------------------------------------------ recording (the assigned Teacher, Smart Guard)

  /** Records the memorization of several students of the session's group: all of it or none of it. */
  async recordMemorization(sessionId: string, userId: string, input: RecordMemorizationInput): Promise<RecordBatchResultDto> {
    const items = parseRecordItems(input.records);
    const session = await this.guard(sessionId, userId, input.gps);
    if (session.status === 'CANCELLED') throw memorizationError('MEMORIZATION_SESSION_CANCELLED');
    await this.assertCurrentlyAssigned(session.groupId, [...new Set(items.map((i) => i.studentId))]);
    const group = await this.groups.getGroup(session.groupId);
    const calculated: Array<{ studentId: string; range: MemorizationRange }> = [];
    for (const item of items) calculated.push({ studentId: item.studentId, range: await this.calculate(item.range) });

    return this.unitOfWork.run(async (tx) => {
      const nextAssignments = await this.repo.lockAssignmentsDefinedInSession(session.id, tx);
      const scheduled = await this.scheduledAssignments(session, group.learningMode, tx);
      const existing = await this.repo.listRecordsBySession(session.id, tx);
      const summaries = new Map<string, RecordSummary[]>();
      for (const r of existing) push(summaries, r.snapshot.studentId, { assignmentId: r.snapshot.assignmentId, matches: r.snapshot.matchesAssignment });

      const created: MemorizationRecord[] = [];
      for (const item of calculated) {
        const assignment = group.learningMode === 'INDIVIDUAL' ? scheduled.find((a) => a.snapshot.studentId === item.studentId) : scheduled.find((a) => a.snapshot.studentId === null);
        const matches = assignment ? sameQuranRange(item.range, assignment.snapshot.range) : null;
        const record = MemorizationRecord.record({
          sessionId: session.id, schoolId: session.schoolId, groupId: session.groupId, studentId: item.studentId, assignmentId: assignment ? assignment.snapshot.id : null,
          range: item.range, matchesAssignment: matches, actorUserId: userId, clock: this.clock,
        });
        created.push(record);
        push(summaries, item.studentId, { assignmentId: assignment ? assignment.snapshot.id : null, matches });
      }
      if (group.learningMode === 'INDIVIDUAL') {
        for (const studentId of new Set(created.map((r) => r.snapshot.studentId))) this.assertNoConflictingNext(studentId, summaries.get(studentId) ?? [], scheduled, nextAssignments);
      }
      await this.repo.insertRecords(created, session.scheduledStart, tx);
      for (const record of created) await this.outbox.publishFrom(record, tx);
      return { sessionId: session.id, results: created.map((r) => ({ studentId: r.snapshot.studentId, outcome: 'RECORDED' as const, record: toRecordDto(r) })) };
    });
  }

  /** The Teacher corrects a record of the session in progress. The original value stays in the history. */
  async correctRecord(recordId: string, userId: string, input: CorrectRecordInput): Promise<RecordCorrectionResultDto> {
    const found = await this.repo.findRecord(recordId);
    if (!found) throw memorizationError('MEMORIZATION_RECORD_NOT_FOUND');
    const session = await this.guard(found.snapshot.sessionId, userId, input.gps);
    this.assertInProgress(session, 'MEMORIZATION_CORRECTION_WINDOW_CLOSED');
    const range = await this.calculate(input.range);
    const group = await this.groups.getGroup(session.groupId);
    return this.unitOfWork.run(async (tx) => {
      const nextAssignments = await this.repo.lockAssignmentsDefinedInSession(session.id, tx);
      const record = await this.repo.lockRecord(recordId, tx);
      if (!record) throw memorizationError('MEMORIZATION_RECORD_NOT_FOUND');
      this.assertInProgress(session, 'MEMORIZATION_CORRECTION_WINDOW_CLOSED');
      const assignment = record.snapshot.assignmentId ? await this.repo.findAssignment(record.snapshot.assignmentId, tx) : undefined;
      const matches = assignment ? sameQuranRange(range, assignment.snapshot.range) : null;
      const entry = record.correct({ range, matchesAssignment: matches, reason: input.reason, actorUserId: userId, clock: this.clock });
      if (!entry) return { outcome: 'UNCHANGED' as const, record: toRecordDto(record) };
      if (group.learningMode === 'INDIVIDUAL') {
        const all = await this.repo.listRecordsBySession(session.id, tx);
        const summaries = all.filter((r) => r.snapshot.studentId === record.snapshot.studentId).map((r) => (r.snapshot.id === record.snapshot.id ? { assignmentId: record.snapshot.assignmentId, matches } : { assignmentId: r.snapshot.assignmentId, matches: r.snapshot.matchesAssignment }));
        const scheduled = assignment ? [assignment] : [];
        this.assertNoConflictingNext(record.snapshot.studentId, summaries, scheduled, nextAssignments);
      }
      await this.repo.applyRecordCorrection(record, entry, tx);
      await this.outbox.publishFrom(record, tx);
      return { outcome: 'CORRECTED' as const, record: toRecordDto(record) };
    });
  }

  // ------------------------------------------------------------------------------------------ reads

  /** A session's memorization for the session's Teacher or the School Manager of its school (the route guard already checked role and scope). */
  async getSessionMemorization(sessionId: string, userId: string, tx?: TransactionContext): Promise<SessionMemorizationDto> {
    const session = await this.sessions.getSession(sessionId);
    const teacher = await this.teachers.findByUserId(userId, tx);
    const isSessionTeacher = teacher !== undefined && teacher.id === session.teacherId;
    if (!isSessionTeacher && !(await this.schools.isSchoolManager(userId, session.schoolId, tx))) throw memorizationError('MEMORIZATION_READ_NOT_ALLOWED');
    const view = await this.scheduledView(session, tx);
    const defined = (await this.repo.listAssignmentsDefinedInSession(session.id, tx)).map(toAssignmentDto);
    return { sessionId: session.id, scheduled: view.assignments, defined, records: view.records };
  }

  /** A student's memorization records over time (the route guard allows the School Manager of the school and the student's own Parent). */
  async listStudentRecords(studentId: string, input: StudentRecordsInput, tx?: TransactionContext): Promise<PageResult<RecordDto>> {
    const { items, total } = await this.repo.listRecordsByStudent(studentId, input.direction ?? 'desc', input.page, tx);
    return buildPageResult(items.map(toRecordDto), total, input.page);
  }

  /**
   * PUBLIC READ for the future Notifications modules (Master Specification §63, half-session reminder): was memorization SCHEDULED for this session (a specific assignment
   * explicitly defined before it started), and which records exist. Creates and changes nothing; a missing record never justifies creating one.
   */
  async getScheduledMemorization(sessionId: string, tx?: TransactionContext): Promise<ScheduledMemorizationDto> {
    const session = await this.sessions.getSession(sessionId, tx);
    const view = await this.scheduledView(session, tx);
    const withRecords = new Set(view.records.map((r) => r.studentId));
    const unrecorded = view.assignments.filter((a) => (a.studentId === null ? view.records.length === 0 : !withRecords.has(a.studentId))).map((a) => a.id);
    return {
      sessionId: session.id, groupId: session.groupId, teacherId: session.teacherId, status: session.status, scheduledStart: session.scheduledStart, scheduledEnd: session.scheduledEnd,
      scheduled: view.assignments.length > 0, assignments: view.assignments, records: view.records, studentsWithRecords: [...withRecords], unrecordedAssignmentIds: unrecorded,
    };
  }

  /** Append-only histories (tests now, History & Audit (35) later; no endpoint yet). */
  listCorrectionsOfSession(sessionId: string, tx?: TransactionContext): Promise<MemorizationCorrection[]> {
    return this.repo.listCorrectionsOfSession(sessionId, tx);
  }
  listAssignmentHistoryOfSession(sessionId: string, tx?: TransactionContext): Promise<AssignmentHistoryEntry[]> {
    return this.repo.listAssignmentHistoryOfSession(sessionId, tx);
  }

  /** The group of a session / assignment / record (the routes authorize against it). */
  findGroupIdOfSession(sessionId: string): Promise<string> {
    return this.sessions.findGroupIdOf(sessionId);
  }
  async findGroupIdOfAssignment(assignmentId: string): Promise<string> {
    const a = await this.repo.findAssignment(assignmentId);
    if (!a) throw memorizationError('MEMORIZATION_ASSIGNMENT_NOT_FOUND');
    return a.snapshot.groupId;
  }
  async findGroupIdOfRecord(recordId: string): Promise<string> {
    const r = await this.repo.findRecord(recordId);
    if (!r) throw memorizationError('MEMORIZATION_RECORD_NOT_FOUND');
    return r.snapshot.groupId;
  }

  // ------------------------------------------------------------------------------------------ internals

  private async scheduledView(session: ClassSessionDto, tx?: TransactionContext): Promise<{ assignments: AssignmentDto[]; records: RecordDto[] }> {
    const group = await this.groups.getGroup(session.groupId);
    const assignments = (await this.scheduledAssignments(session, group.learningMode, tx)).map(toAssignmentDto);
    const records = (await this.repo.listRecordsBySession(session.id, tx)).map(toRecordDto);
    return { assignments, records };
  }

  /**
   * The assignments SCHEDULED for a session: ACTIVE assignments of the group of the current learning mode, defined in a session that had already ended when this one
   * started (never one defined during it), the newest per student (or the shared one), and not yet fulfilled in an EARLIER session. An assignment nobody fulfilled and nobody
   * replaced stays scheduled for every later session: this is how cancellation, rescheduling and Teacher absence carry it forward unchanged. Stable for past sessions.
   */
  private async scheduledAssignments(session: ClassSessionDto, mode: string, tx?: TransactionContext): Promise<MemorizationAssignment[]> {
    const active = await this.repo.listActiveAssignmentsOfGroup(session.groupId, tx);
    const newest = new Map<string, { a: MemorizationAssignment; at: number }>();
    for (const a of active) {
      if (a.snapshot.definedInSessionId === session.id) continue;
      if ((mode === 'GROUP') !== (a.snapshot.studentId === null)) continue;
      const defining = await this.sessions.getSession(a.snapshot.definedInSessionId, tx);
      if (defining.scheduledEnd.getTime() > session.scheduledStart.getTime()) continue;
      const key = subjectKeyOf(a.snapshot.studentId);
      const at = defining.scheduledStart.getTime() * 1_000 + (a.snapshot.createdAt.getTime() % 1_000);
      const current = newest.get(key);
      if (!current || at > current.at) newest.set(key, { a, at });
    }
    const candidates = [...newest.values()].map((x) => x.a);
    const fulfilled = await this.repo.fulfilledBefore(candidates.map((a) => a.snapshot.id), session.scheduledStart, tx);
    return candidates.filter((a) => !fulfilled.has(a.snapshot.id));
  }

  /** In an INDIVIDUAL group a student who did not fulfil their assignment in this session gets the ENTIRE original assignment again: no different next assignment. */
  private async assertRepeatRespected(sessionId: string, studentId: string, next: MemorizationRange, tx: TransactionContext): Promise<void> {
    const records = (await this.repo.listRecordsBySession(sessionId, tx)).filter((r) => r.snapshot.studentId === studentId);
    for (const assignmentId of unfulfilledAssignmentIds(records.map((r) => ({ assignmentId: r.snapshot.assignmentId, matches: r.snapshot.matchesAssignment })))) {
      const original = await this.repo.findAssignment(assignmentId, tx);
      if (original && !sameQuranRange(original.snapshot.range, next)) throw memorizationError('MEMORIZATION_REPEAT_REQUIRED');
    }
  }

  private assertNoConflictingNext(studentId: string, summaries: readonly RecordSummary[], scheduled: readonly MemorizationAssignment[], nextAssignments: readonly MemorizationAssignment[]): void {
    const next = nextAssignments.find((a) => a.snapshot.status === 'ACTIVE' && a.snapshot.studentId === studentId);
    if (!next) return;
    for (const assignmentId of unfulfilledAssignmentIds(summaries)) {
      const original = scheduled.find((a) => a.snapshot.id === assignmentId);
      if (original && !sameQuranRange(original.snapshot.range, next.snapshot.range)) throw memorizationError('MEMORIZATION_RECORD_CONFLICTS_WITH_NEXT_ASSIGNMENT');
    }
  }

  private parseSubject(mode: string, studentId: unknown): string | null {
    if (mode === 'GROUP') {
      if (studentId !== undefined && studentId !== null) throw memorizationError('MEMORIZATION_GROUP_ASSIGNMENT_NO_STUDENT');
      return null;
    }
    if (typeof studentId !== 'string' || studentId.trim() === '') throw memorizationError('MEMORIZATION_STUDENT_REQUIRED');
    return studentId;
  }

  private async calculate(range: unknown): Promise<MemorizationRange> {
    if (typeof range !== 'object' || range === null || Array.isArray(range)) throw memorizationError('MEMORIZATION_RANGE_REQUIRED');
    return toMemorizationRange(await this.ranges.calculate(range as never));
  }

  private async requireSessionTeacher(userId: string, session: ClassSessionDto): Promise<string> {
    const teacher = await this.teachers.findByUserId(userId);
    if (!teacher || teacher.id !== session.teacherId) throw memorizationError('MEMORIZATION_NOT_SESSION_TEACHER');
    return teacher.id;
  }

  /** In progress = status IN_PROGRESS and the scheduled end has not been reached (the scheduler may lag a few seconds behind the clock). */
  private assertInProgress(session: ClassSessionDto, code: 'MEMORIZATION_ASSIGNMENT_WINDOW_CLOSED' | 'MEMORIZATION_CORRECTION_WINDOW_CLOSED'): void {
    if (session.status !== 'IN_PROGRESS' || this.clock.now().getTime() >= session.scheduledEnd.getTime()) throw memorizationError(code);
  }

  private async guard(sessionId: string, userId: string, gps: unknown): Promise<ClassSessionDto> {
    const teacher = await this.teachers.findByUserId(userId);
    if (!teacher) throw smartGuardError('SMART_GUARD_NOT_SESSION_TEACHER');
    await this.smartGuard.check({ teacherId: teacher.id, sessionId, gps });
    return this.sessions.getSession(sessionId);
  }

  private async assertCurrentlyAssigned(groupId: string, studentIds: readonly string[]): Promise<void> {
    const missing: string[] = [];
    for (const studentId of studentIds) {
      const history = await this.groups.listAssignmentHistoryOfStudent(studentId);
      if (!history.some((a) => a.groupId === groupId && a.unassignedAt === null)) missing.push(studentId);
    }
    if (missing.length > 0) throw memorizationError('MEMORIZATION_STUDENT_NOT_IN_GROUP', { studentIds: missing });
  }
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/** Assignments that have records but none of them fulfils the assignment. */
function unfulfilledAssignmentIds(records: readonly RecordSummary[]): string[] {
  const state = new Map<string, boolean>();
  for (const r of records) if (r.assignmentId !== null) state.set(r.assignmentId, (state.get(r.assignmentId) ?? false) || r.matches === true);
  return [...state].filter(([, fulfilled]) => !fulfilled).map(([id]) => id);
}

/** Validates the batch before anything else: 1..200 records, each `{ studentId, range }`. A student may appear more than once (records are independent). */
function parseRecordItems(records: unknown): Array<{ studentId: string; range: unknown }> {
  if (!Array.isArray(records) || records.length === 0) throw memorizationError('MEMORIZATION_RECORDS_REQUIRED');
  if (records.length > MAX_BATCH_RECORDS) throw memorizationError('MEMORIZATION_TOO_MANY_RECORDS', { max: MAX_BATCH_RECORDS }, { max: MAX_BATCH_RECORDS });
  return records.map((item: unknown) => {
    const rec = (typeof item === 'object' && item !== null ? item : {}) as Record<string, unknown>;
    if (typeof rec.studentId !== 'string' || rec.studentId.trim() === '') throw memorizationError('MEMORIZATION_INVALID_RECORD');
    return { studentId: rec.studentId, range: rec.range };
  });
}
