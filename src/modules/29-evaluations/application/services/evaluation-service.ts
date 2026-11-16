import { SystemClock, buildPageResult, type Clock, type PageRequest, type PageResult, type TransactionContext, type UnitOfWork } from '../../../00-shared-kernel/public';
import type { OutboxService } from '../../../06-domain-events-outbox/public';
import type { SchoolLookup } from '../../../16-schools/public';
import type { TeacherLookup } from '../../../18-teachers/public';
import type { GroupService } from '../../../20-groups/public';
import type { ClassSessionService } from '../../../24-sessions/public';
import { smartGuardError, type SmartGuard } from '../../../25-smart-guard/public';
import type { AttendanceService } from '../../../26-attendance/public';
import type { MemorizationService } from '../../../27-memorization/public';
import type { RevisionService } from '../../../28-revision/public';
import { Evaluation, normalizeNote, type EvaluationScore } from '../../domain/entities/evaluation';
import { evaluationError } from '../../domain/errors/evaluation-errors';
import { evaluationPhaseAt, graceEndsAt, warningDueAt, type EvaluationPhase } from '../../domain/services/evaluation-window';
import {
  GRACE_MINUTES, MAX_BATCH_STUDENTS, assignmentRefsOf, availableCategories, isAcceptableScore, isEvaluationCategory, roundScore, type AssignmentContext, type EvaluationCategory,
} from '../../domain/value-objects/evaluation-rules';
import {
  toEvaluationDto, type AttendanceView, type EvaluationBatchResultDto, type EvaluationChangeResultDto, type EvaluationDto, type SessionEvaluationStatusDto, type SessionEvaluationsDto, type StudentEvaluationStatusDto,
} from '../dto/evaluation-dto';
import type { EvaluationRepository } from '../ports/evaluation-repository';

export interface EvaluationServiceDeps {
  readonly evaluations: EvaluationRepository;
  /** Module 24: the session, its group, and the session row lock (the per-session serialization that makes the attendance/evaluation rule hold under concurrency). */
  readonly sessions: Pick<ClassSessionService, 'getSession' | 'findGroupIdOf' | 'lockSession'>;
  /** Module 25: every Teacher write goes through it, with the approved narrow post-completion grace exception (`allowAfterEndMinutes`). */
  readonly smartGuard: Pick<SmartGuard, 'check'>;
  readonly teachers: Pick<TeacherLookup, 'findByUserId'>;
  /** Module 20: the eligible roster (students currently assigned to the group). */
  readonly groups: Pick<GroupService, 'listAssignmentHistoryOfStudent' | 'listStudentsOfGroup'>;
  /** Module 16: is this user the School Manager of the school. */
  readonly schools: Pick<SchoolLookup, 'isSchoolManager'>;
  /** Module 26: attendance statuses (ABSENT forbids an evaluation; UNMARKED is never ABSENT). */
  readonly attendance: Pick<AttendanceService, 'lockStudentStatuses' | 'listStudentStatuses'>;
  /** Module 27 / 28: the assignments scheduled for the session. Only their existence matters here; no execution record is needed. */
  readonly memorization: Pick<MemorizationService, 'getScheduledMemorization'>;
  readonly revision: Pick<RevisionService, 'getScheduledRevision'>;
  readonly unitOfWork: UnitOfWork;
  readonly outbox: OutboxService;
  readonly clock?: Clock;
}

export interface RecordEvaluationsInput {
  /** `{ latitude, longitude, accuracyMeters }`: validated by Smart Guard. */
  readonly gps: unknown;
  /** `[{ studentId, scores: [{ category, score }], note? }]`. */
  readonly records: unknown;
}

export interface EvaluationListInput {
  readonly direction?: 'asc' | 'desc';
  readonly page: PageRequest;
}

interface Entry {
  readonly studentId: string;
  readonly scores: ReadonlyArray<{ category: EvaluationCategory; score: number }>;
  readonly note: string | null;
}

/** Internal signal: another request inserted the same (session, student) first. The whole transaction rolls back and the operation is retried. */
class ConcurrentInsert extends Error {}

const MAX_ATTEMPTS = 3;
const ROSTER_PAGE_SIZE = 100;

/**
 * Public application contract of Module 29 (Evaluations, Master Specification §52 as amended by the approved Module 29 decisions).
 *
 *  - ONLY the Teacher assigned to the session creates or modifies evaluations, in ONE atomic batch with ONE GPS reading, through Smart Guard. The School Manager cannot.
 *  - An evaluation exists only for a student with a Memorization and/or Revision ASSIGNMENT for the session (the assignment is enough; no execution record is needed). The
 *    categories follow the assignments (`availableCategories`); creation needs ALL of them, each with its own 0.00-10.00 score (rounded to two decimals), per student, plus
 *    ONE optional note of at most 200 characters, saved once and never changed.
 *  - ATTENDANCE (cross-module invariant, enforced in ONE transaction under the session row lock): a student marked ABSENT cannot be evaluated, and (Module 26's veto, fed by
 *    `findEvaluatedStudents`) a student already evaluated cannot be marked ABSENT. UNMARKED is never read as ABSENT.
 *  - WINDOW (by the SCHEDULED end, Module 24): until the end the Teacher records and may modify scores; for 15 minutes after the end only MISSING evaluations can be recorded
 *    (Smart Guard + GPS still required: the narrow `allowAfterEndMinutes` exception); then every write is closed for good. A missing evaluation is NEVER created by the system.
 *  - NO history: a score change overwrites the score. Events (EvaluationRecorded / EvaluationScoresUpdated) carry the integration data the Notifications modules need for the
 *    Parent; nothing is notified here. `getSessionEvaluationStatus` is the read for the pre-end warning.
 * Route guards authorize first (roles, permissions, scope); this service adds ownership, the window and the business rules.
 */
export class EvaluationService {
  private readonly repo: EvaluationRepository;
  private readonly sessions: EvaluationServiceDeps['sessions'];
  private readonly smartGuard: EvaluationServiceDeps['smartGuard'];
  private readonly teachers: EvaluationServiceDeps['teachers'];
  private readonly groups: EvaluationServiceDeps['groups'];
  private readonly schools: EvaluationServiceDeps['schools'];
  private readonly attendance: EvaluationServiceDeps['attendance'];
  private readonly memorization: EvaluationServiceDeps['memorization'];
  private readonly revision: EvaluationServiceDeps['revision'];
  private readonly unitOfWork: UnitOfWork;
  private readonly outbox: OutboxService;
  private readonly clock: Clock;

  constructor(deps: EvaluationServiceDeps) {
    this.repo = deps.evaluations;
    this.sessions = deps.sessions;
    this.smartGuard = deps.smartGuard;
    this.teachers = deps.teachers;
    this.groups = deps.groups;
    this.schools = deps.schools;
    this.attendance = deps.attendance;
    this.memorization = deps.memorization;
    this.revision = deps.revision;
    this.unitOfWork = deps.unitOfWork;
    this.outbox = deps.outbox;
    this.clock = deps.clock ?? new SystemClock();
  }

  // ------------------------------------------------------------------------------------------ writes (the session's Teacher, Smart Guard)

  /**
   * Creates the evaluations of students that have none and modifies scores of existing ones, all of it or none of it. Outcomes per student: RECORDED (created), UPDATED (a score
   * changed), UNCHANGED (the same scores again). After the scheduled end (grace) an existing evaluation cannot be touched: only missing ones are created.
   */
  async recordEvaluations(sessionId: string, userId: string, input: RecordEvaluationsInput): Promise<EvaluationBatchResultDto> {
    const entries = parseEntries(input.records);
    const teacher = await this.teachers.findByUserId(userId);
    if (!teacher) throw smartGuardError('SMART_GUARD_NOT_SESSION_TEACHER');
    // The ONLY caller that passes the grace exception (approved). Smart Guard checks ownership, the window (start - 15 min .. end + 15 min), GPS and a non-cancelled session.
    await this.smartGuard.check({ teacherId: teacher.id, sessionId, gps: input.gps, allowAfterEndMinutes: GRACE_MINUTES });
    const session = await this.sessions.getSession(sessionId);
    await this.assertCurrentlyAssigned(session.groupId, entries.map((e) => e.studentId));
    const studentIds = entries.map((e) => e.studentId);

    for (let attempt = 1; ; attempt += 1) {
      try {
        const results = await this.unitOfWork.run(async (tx): Promise<EvaluationChangeResultDto[]> => {
          // 1. The per-session lock: serializes this write with any ABSENT marking of Module 26 (which takes the same lock first), so the attendance rule holds under concurrency.
          const locked = await this.sessions.lockSession(session.id, tx);
          if (locked.status === 'CANCELLED') throw evaluationError('EVALUATION_SESSION_CANCELLED');
          // 2. The window, by the SCHEDULED end (never by processing delay): judged inside the lock, at the moment of the write.
          const phase = evaluationPhaseAt(this.clock.now(), locked.scheduledEnd);
          if (phase === 'CLOSED') throw evaluationError('EVALUATION_WRITE_WINDOW_CLOSED', { closedAt: graceEndsAt(locked.scheduledEnd).toISOString() });
          // 3. Attendance: ABSENT cannot be evaluated (locking read: the latest committed status).
          const statuses = await this.attendance.lockStudentStatuses(session.id, studentIds, tx);
          const absent = studentIds.filter((id) => statuses.get(id) === 'ABSENT');
          if (absent.length > 0) throw evaluationError('EVALUATION_STUDENT_ABSENT', { studentIds: absent });
          // 4. The current state.
          const existing = new Map((await this.repo.lockBySessionAndStudents(session.id, studentIds, tx)).map((e) => [e.snapshot.studentId, e]));
          const contexts = await this.assignmentContexts(session.id, studentIds, tx);
          return this.applyEntries(locked, userId, entries, existing, contexts, phase, tx);
        });
        return { sessionId: session.id, results };
      } catch (error) {
        if (!(error instanceof ConcurrentInsert)) throw error;
        if (attempt >= MAX_ATTEMPTS) throw evaluationError('EVALUATION_CONCURRENT_CHANGE');
      }
    }
  }

  /** Plans every entry first (so ANY invalid one rejects the whole request before anything is written), then writes them all in the caller's transaction. */
  private async applyEntries(
    session: { id: string; schoolId: string; groupId: string; occurrenceDate: string; scheduledStart: Date },
    userId: string,
    entries: readonly Entry[],
    existing: ReadonlyMap<string, Evaluation>,
    contexts: ReadonlyMap<string, AssignmentContext>,
    phase: EvaluationPhase,
    tx: TransactionContext,
  ): Promise<EvaluationChangeResultDto[]> {
    // Students without an evaluation need an applicable assignment (the assignment is what makes an evaluation available).
    const noAssignment = entries.filter((e) => !existing.has(e.studentId) && availableCategories(contexts.get(e.studentId) ?? NO_CONTEXT).length === 0).map((e) => e.studentId);
    if (noAssignment.length > 0) throw evaluationError('EVALUATION_NO_APPLICABLE_ASSIGNMENT', { studentIds: noAssignment });
    // After the scheduled end ONLY missing evaluations can be recorded: an existing one cannot be touched (no score change, no duplicate).
    if (phase === 'GRACE') {
      const touched = entries.filter((e) => existing.has(e.studentId)).map((e) => e.studentId);
      if (touched.length > 0) throw evaluationError('EVALUATION_GRACE_CREATE_ONLY', { studentIds: touched, graceMinutes: GRACE_MINUTES }, { minutes: GRACE_MINUTES });
    }

    type Planned = { entry: Entry; evaluation: Evaluation; isNew: boolean };
    const planned: Planned[] = entries.map((entry) => {
      const current = existing.get(entry.studentId);
      if (!current) {
        const context = contexts.get(entry.studentId) ?? NO_CONTEXT;
        const available = availableCategories(context);
        const submitted = entry.scores.map((s) => s.category);
        if (submitted.length !== available.length || !available.every((c) => submitted.includes(c))) {
          throw evaluationError('EVALUATION_CATEGORIES_MISMATCH', { studentId: entry.studentId, availableCategories: available, submittedCategories: submitted });
        }
        const scores: EvaluationScore[] = entry.scores.map((s) => ({ category: s.category, score: s.score, ...assignmentRefsOf(s.category, context) }));
        const evaluation = Evaluation.create({
          sessionId: session.id, schoolId: session.schoolId, groupId: session.groupId, studentId: entry.studentId, occurrenceDate: session.occurrenceDate, scheduledStart: session.scheduledStart,
          note: entry.note, scores, actorUserId: userId, clock: this.clock,
        });
        return { entry, evaluation, isNew: true };
      }
      // Modification (only while the session lasts): the note is immutable; only categories the evaluation already has.
      if (entry.note !== null && entry.note !== current.snapshot.note) throw evaluationError('EVALUATION_NOTE_IMMUTABLE');
      const have = current.snapshot.scores.map((s) => s.category);
      if (entry.scores.some((s) => !have.includes(s.category))) {
        throw evaluationError('EVALUATION_CATEGORIES_MISMATCH', { studentId: entry.studentId, availableCategories: have, submittedCategories: entry.scores.map((s) => s.category) });
      }
      return { entry, evaluation: current, isNew: false };
    });

    const out: EvaluationChangeResultDto[] = [];
    for (const p of planned) {
      if (p.isNew) {
        if (!(await this.repo.insertIfAbsent(p.evaluation, tx))) throw new ConcurrentInsert();
        await this.outbox.publishFrom(p.evaluation, tx);
        out.push({ studentId: p.entry.studentId, outcome: 'RECORDED', evaluation: toEvaluationDto(p.evaluation) });
        continue;
      }
      const changed = p.evaluation.changeScores({ scores: p.entry.scores, actorUserId: userId, clock: this.clock });
      if (changed.length > 0) {
        await this.repo.saveScores(p.evaluation, tx);
        await this.outbox.publishFrom(p.evaluation, tx);
        out.push({ studentId: p.entry.studentId, outcome: 'UPDATED', evaluation: toEvaluationDto(p.evaluation) });
      } else {
        out.push({ studentId: p.entry.studentId, outcome: 'UNCHANGED', evaluation: toEvaluationDto(p.evaluation) });
      }
    }
    return out;
  }

  // ------------------------------------------------------------------------------------------ the Module 26 veto (an evaluation blocks marking ABSENT)

  /**
   * Which of these students already have an evaluation for the session. Used by Module 26 (through the composition root) INSIDE its transaction, after it took the session row
   * lock, to refuse marking an evaluated student ABSENT. A locking read, so an evaluation that has just committed is never missed.
   */
  findEvaluatedStudents(sessionId: string, studentIds: readonly string[], tx: TransactionContext): Promise<string[]> {
    return this.repo.lockEvaluatedStudentIds(sessionId, studentIds, tx);
  }

  // ------------------------------------------------------------------------------------------ reads

  /** A session's evaluations. Only the Teacher assigned to the session or the School Manager of its school (the route guard already checked the role and scope). */
  async getSessionEvaluations(sessionId: string, userId: string, tx?: TransactionContext): Promise<SessionEvaluationsDto> {
    const session = await this.sessions.getSession(sessionId, tx);
    const teacher = await this.teachers.findByUserId(userId, tx);
    const isSessionTeacher = teacher !== undefined && teacher.id === session.teacherId;
    if (!isSessionTeacher && !(await this.schools.isSchoolManager(userId, session.schoolId, tx))) throw evaluationError('EVALUATION_READ_NOT_ALLOWED');
    return { sessionId, evaluations: (await this.repo.listBySession(sessionId, tx)).map(toEvaluationDto) };
  }

  /** A student's evaluations over time (the route guard allows the School Manager of the school and the student's own Parent). Newest session first by default. */
  async listStudentEvaluations(studentId: string, input: EvaluationListInput, tx?: TransactionContext): Promise<PageResult<EvaluationDto>> {
    const { items, total } = await this.repo.listByStudent(studentId, input.direction ?? 'desc', input.page, tx);
    return buildPageResult(items.map(toEvaluationDto), total, input.page);
  }

  /**
   * The integration data for the pre-end warning (the Notifications modules 31-34 deliver it; nothing is notified here): for the students currently in the group, their
   * attendance, the categories available, whether they are evaluated, and which are REQUIRED but still missing. Creates and changes nothing.
   */
  async getSessionEvaluationStatus(sessionId: string, tx?: TransactionContext): Promise<SessionEvaluationStatusDto> {
    const session = await this.sessions.getSession(sessionId, tx);
    const studentIds: string[] = [];
    for (let page = 1; ; page += 1) {
      const batch = await this.groups.listStudentsOfGroup(session.groupId, { page, pageSize: ROSTER_PAGE_SIZE }, 'asc', tx);
      studentIds.push(...batch.items.map((s) => s.studentId));
      if (studentIds.length >= batch.total || batch.items.length === 0) break;
    }
    const statuses = await this.attendance.listStudentStatuses(sessionId, tx);
    const contexts = await this.assignmentContexts(sessionId, studentIds, tx);
    const evaluated = new Set((await this.repo.listBySession(sessionId, tx)).map((e) => e.snapshot.studentId));
    const students: StudentEvaluationStatusDto[] = studentIds.map((studentId) => {
      const attendance: AttendanceView = statuses.get(studentId) ?? 'UNMARKED';
      const categories = availableCategories(contexts.get(studentId) ?? NO_CONTEXT);
      const isEvaluated = evaluated.has(studentId);
      return { studentId, attendance, availableCategories: categories, evaluated: isEvaluated, evaluationRequired: attendance === 'PRESENT' && categories.length > 0 && !isEvaluated };
    });
    return {
      sessionId, groupId: session.groupId, teacherId: session.teacherId, status: session.status, scheduledStart: session.scheduledStart, scheduledEnd: session.scheduledEnd,
      warningDueAt: warningDueAt(session.scheduledEnd), graceEndsAt: graceEndsAt(session.scheduledEnd), students, incompleteStudentIds: students.filter((s) => s.evaluationRequired).map((s) => s.studentId),
    };
  }

  /** The group of a session (the routes authorize against it). Module 24's NOT_FOUND for an unknown session. */
  findGroupIdOfSession(sessionId: string): Promise<string> {
    return this.sessions.findGroupIdOf(sessionId);
  }

  // ------------------------------------------------------------------------------------------ internals

  /** Is every one of these students currently assigned to the session's group? (Module 20's assignment history: the open assignment is the current one.) */
  private async assertCurrentlyAssigned(groupId: string, studentIds: readonly string[]): Promise<void> {
    const missing: string[] = [];
    for (const studentId of studentIds) {
      const history = await this.groups.listAssignmentHistoryOfStudent(studentId);
      if (!history.some((a) => a.groupId === groupId && a.unassignedAt === null)) missing.push(studentId);
    }
    if (missing.length > 0) throw evaluationError('EVALUATION_STUDENT_NOT_IN_GROUP', { studentIds: missing });
  }

  /** The Memorization and Revision assignment that applies to each student for the session (a shared GROUP assignment applies to everyone; an individual one to its student). */
  private async assignmentContexts(sessionId: string, studentIds: readonly string[], tx?: TransactionContext): Promise<Map<string, AssignmentContext>> {
    const memorization = (await this.memorization.getScheduledMemorization(sessionId, tx)).assignments;
    const revision = (await this.revision.getScheduledRevision(sessionId, tx)).assignments;
    const pick = (list: ReadonlyArray<{ id: string; studentId: string | null }>, studentId: string): string | null =>
      (list.find((a) => a.studentId === studentId) ?? list.find((a) => a.studentId === null))?.id ?? null;
    return new Map(studentIds.map((id) => [id, { memorizationAssignmentId: pick(memorization, id), revisionAssignmentId: pick(revision, id) }]));
  }
}

const NO_CONTEXT: AssignmentContext = { memorizationAssignmentId: null, revisionAssignmentId: null };

/** Validates the request before anything else: 1..200 students, each `{ studentId, scores: [{ category, score }], note? }`, no student or category twice. Scores are rounded to 2 decimals here. */
function parseEntries(records: unknown): Entry[] {
  if (!Array.isArray(records) || records.length === 0) throw evaluationError('EVALUATION_RECORDS_REQUIRED');
  if (records.length > MAX_BATCH_STUDENTS) throw evaluationError('EVALUATION_TOO_MANY_RECORDS', { max: MAX_BATCH_STUDENTS }, { max: MAX_BATCH_STUDENTS });
  const seen = new Set<string>();
  return records.map((item: unknown) => {
    const rec = (typeof item === 'object' && item !== null ? item : {}) as Record<string, unknown>;
    if (typeof rec.studentId !== 'string' || rec.studentId.trim() === '' || !Array.isArray(rec.scores) || rec.scores.length === 0) throw evaluationError('EVALUATION_INVALID_RECORD');
    if (seen.has(rec.studentId)) throw evaluationError('EVALUATION_DUPLICATE_STUDENT', { studentId: rec.studentId });
    seen.add(rec.studentId);
    const categories = new Set<string>();
    const scores = rec.scores.map((raw: unknown) => {
      const s = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
      if (!isEvaluationCategory(s.category)) throw evaluationError('EVALUATION_INVALID_CATEGORY');
      if (categories.has(s.category)) throw evaluationError('EVALUATION_DUPLICATE_CATEGORY', { category: s.category });
      categories.add(s.category);
      if (!isAcceptableScore(s.score)) throw evaluationError('EVALUATION_INVALID_SCORE', { category: s.category });
      return { category: s.category, score: roundScore(s.score) };
    });
    return { studentId: rec.studentId, scores, note: normalizeNote(rec.note) };
  });
}
