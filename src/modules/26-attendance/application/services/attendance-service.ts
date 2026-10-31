import { SystemClock, buildPageResult, type Clock, type PageRequest, type PageResult, type TransactionContext, type UnitOfWork } from '../../../00-shared-kernel/public';
import type { OutboxService } from '../../../06-domain-events-outbox/public';
import type { SchoolLookup } from '../../../16-schools/public';
import type { TeacherLookup } from '../../../18-teachers/public';
import type { GroupService } from '../../../20-groups/public';
import type { ClassSessionDto, ClassSessionService } from '../../../24-sessions/public';
import { smartGuardError, type SmartGuard } from '../../../25-smart-guard/public';
import { AttendanceRecord } from '../../domain/entities/attendance-record';
import type { AttendanceCorrection } from '../../domain/entities/attendance-record';
import { attendanceError } from '../../domain/errors/attendance-errors';
import { MAX_BATCH_RECORDS, SYSTEM_ACTOR_ID, SYSTEM_CANCELLATION_REASON, isAttendanceStatus, type ActorRole, type AttendanceStatus, type SubjectType } from '../../domain/value-objects/attendance-status';
import { toAttendanceDto, type AttendanceBatchResultDto, type AttendanceChangeResultDto, type AttendanceRecordDto, type SessionAttendanceDto } from '../dto/attendance-dto';
import type { AttendanceRepository } from '../ports/attendance-repository';

export interface AttendanceServiceDeps {
  readonly attendance: AttendanceRepository;
  /** Module 24: the session (times, school, group, Teacher, status) and the group of a session. */
  readonly sessions: Pick<ClassSessionService, 'getSession' | 'findGroupIdOf'>;
  /** Module 25: the protected Teacher actions go through it (GPS, time window, ownership, session not cancelled). */
  readonly smartGuard: Pick<SmartGuard, 'check'>;
  readonly teachers: Pick<TeacherLookup, 'findByUserId'>;
  /** Module 20: who is currently assigned to a group. */
  readonly groups: Pick<GroupService, 'listAssignmentHistoryOfStudent'>;
  /** Module 16: is this user the School Manager of the school (read access to a session's attendance). */
  readonly schools: Pick<SchoolLookup, 'isSchoolManager'>;
  readonly unitOfWork: UnitOfWork;
  readonly outbox: OutboxService;
  readonly clock?: Clock;
}

export interface StudentAttendanceInput {
  /** `{ latitude, longitude, accuracyMeters }`: validated by Smart Guard. */
  readonly gps: unknown;
  /** `[{ studentId, status, reason? }]`; `reason` is required only for a student whose existing record changes status. */
  readonly records: unknown;
}

export interface TeacherCheckInInput {
  readonly gps: unknown;
  /** Required only when an ABSENT record exists and the check-in changes it to PRESENT (a correction). */
  readonly reason?: unknown;
}

export interface ManagerAttendanceInput {
  readonly status: unknown;
  /** Required when an existing record changes status (a correction); not needed for a first marking. */
  readonly reason?: unknown;
}

export interface AttendanceListInput {
  readonly direction?: 'asc' | 'desc';
  readonly page: PageRequest;
}

/** What the system needs to know about a session that ended or was cancelled (all of it is in the Module 24 event). */
export interface SessionEndFacts {
  readonly sessionId: string;
  readonly schoolId: string;
  readonly groupId: string;
  /** The Teacher assigned to the session (Module 18 record id). */
  readonly teacherId: string;
  readonly occurrenceDate: string;
  readonly scheduledStart: Date;
}

export type SystemAbsenceOutcome = 'RECORDED' | 'CORRECTED' | 'UNCHANGED';

interface Change {
  readonly subjectId: string;
  readonly status: AttendanceStatus;
  readonly reason: unknown;
}

/** Internal signal: another request inserted the same (session, subject) first. The whole transaction rolls back and the operation is retried. */
class ConcurrentInsert extends Error {}

const MAX_ATTEMPTS = 3;

/**
 * Public application contract of Module 26 (Attendance, Master Specification §51) and the approved Module 26 decisions of the project owner.
 *
 *  - The assigned Teacher records STUDENT attendance in ONE atomic batch with ONE GPS reading, through Smart Guard (GPS, window, ownership, session not cancelled).
 *    Only students CURRENTLY assigned to the session's group may be included. Students nobody marks stay UNMARKED: they are never created or marked ABSENT automatically.
 *  - The Teacher checks themself in as PRESENT through Smart Guard; the School Manager may record or correct the Teacher's attendance.
 *  - A School Manager records or corrects student and Teacher attendance at ANY time, WITHOUT GPS (but never for a cancelled session).
 *  - THE ONE AUTOMATIC RULE (approved): a Teacher is ABSENT in a session they did not check in to when it is COMPLETED, and ABSENT in a session they CANCEL. The system
 *    records it (actor role SYSTEM) from the Module 24 events. Students are never marked automatically.
 *  - The first marking of a subject needs no reason. CHANGING an existing record is a correction: it needs a non-empty reason, keeps the previous value in the
 *    append-only history (actor, role, time, previous, new, reason) and publishes AttendanceCorrected. The same status again changes nothing.
 *  - Unique per (session, subject). Nothing is ever deleted. Cancelled sessions accept no attendance.
 *  - Notification delivery (e.g. the half-session reminder) is NOT here: it belongs to Modules 31-34 (docs/ATTENDANCE.md).
 * Route guards authorize first (roles, permissions, scope); this service adds ownership and business rules.
 */
export class AttendanceService {
  private readonly attendance: AttendanceRepository;
  private readonly sessions: AttendanceServiceDeps['sessions'];
  private readonly smartGuard: AttendanceServiceDeps['smartGuard'];
  private readonly teachers: AttendanceServiceDeps['teachers'];
  private readonly groups: AttendanceServiceDeps['groups'];
  private readonly schools: AttendanceServiceDeps['schools'];
  private readonly unitOfWork: UnitOfWork;
  private readonly outbox: OutboxService;
  private readonly clock: Clock;

  constructor(deps: AttendanceServiceDeps) {
    this.attendance = deps.attendance;
    this.sessions = deps.sessions;
    this.smartGuard = deps.smartGuard;
    this.teachers = deps.teachers;
    this.groups = deps.groups;
    this.schools = deps.schools;
    this.unitOfWork = deps.unitOfWork;
    this.outbox = deps.outbox;
    this.clock = deps.clock ?? new SystemClock();
  }

  // ------------------------------------------------------------------------------------------ the assigned Teacher (Smart Guard)

  /** Records or corrects the attendance of several students of the session's group: all of it or none of it. */
  async recordStudentAttendance(sessionId: string, userId: string, input: StudentAttendanceInput): Promise<AttendanceBatchResultDto> {
    const changes = parseStudentChanges(input.records);
    const session = await this.guard(sessionId, userId, input.gps);
    return this.apply(session, { userId, role: 'TEACHER' }, 'STUDENT', changes, 'ALL');
  }

  /** The Teacher records their own attendance as PRESENT. */
  async checkInTeacher(sessionId: string, userId: string, input: TeacherCheckInInput): Promise<AttendanceBatchResultDto> {
    const session = await this.guard(sessionId, userId, input.gps);
    return this.apply(session, { userId, role: 'TEACHER' }, 'TEACHER', [{ subjectId: session.teacherId, status: 'PRESENT', reason: input.reason }], 'NONE');
  }

  // ------------------------------------------------------------------------------------------ the School Manager (no GPS)

  /** The School Manager records the session's Teacher as ABSENT/PRESENT or corrects the Teacher's record, at any time. */
  async setTeacherAttendanceByManager(sessionId: string, managerUserId: string, input: ManagerAttendanceInput): Promise<AttendanceBatchResultDto> {
    const status = parseStatus(input.status);
    const session = await this.openSession(sessionId);
    return this.apply(session, { userId: managerUserId, role: 'SCHOOL_MANAGER' }, 'TEACHER', [{ subjectId: session.teacherId, status, reason: input.reason }], 'NONE');
  }

  /** The School Manager records or corrects ONE student's attendance, at any time. A student without a record must currently be assigned to the group. */
  async setStudentAttendanceByManager(sessionId: string, studentId: string, managerUserId: string, input: ManagerAttendanceInput): Promise<AttendanceBatchResultDto> {
    const status = parseStatus(input.status);
    const session = await this.openSession(sessionId);
    return this.apply(session, { userId: managerUserId, role: 'SCHOOL_MANAGER' }, 'STUDENT', [{ subjectId: studentId, status, reason: input.reason }], 'NEW_ONLY');
  }

  // ------------------------------------------------------------------------------------------ the one automatic rule (the system, from Module 24 events)

  /**
   * The session was COMPLETED: a Teacher with NO attendance record for it is ABSENT (created by the SYSTEM, AttendanceRecorded). An existing record (PRESENT or ABSENT,
   * by the Teacher or the School Manager) is never touched. Idempotent: delivered twice, it changes nothing the second time.
   */
  markTeacherAbsentForCompletedSession(facts: SessionEndFacts): Promise<SystemAbsenceOutcome> {
    return this.systemTeacherAbsence(facts, false);
  }

  /**
   * The Teacher CANCELLED the session: the Teacher is ABSENT in it. No record -> ABSENT is recorded; an existing PRESENT record (the Teacher had checked in) is changed to
   * ABSENT as a CORRECTION by the SYSTEM, with the previous value kept in the append-only history. A cancellation by the system (retired schedule slot) never calls this.
   * Idempotent.
   */
  markTeacherAbsentForSessionCancelledByTeacher(facts: SessionEndFacts): Promise<SystemAbsenceOutcome> {
    return this.systemTeacherAbsence(facts, true);
  }

  private async systemTeacherAbsence(facts: SessionEndFacts, overridePresent: boolean): Promise<SystemAbsenceOutcome> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.unitOfWork.run(async (tx): Promise<SystemAbsenceOutcome> => {
          const [existing] = await this.attendance.lockSubjects(facts.sessionId, 'TEACHER', [facts.teacherId], tx);
          if (!existing) {
            const record = AttendanceRecord.record({
              sessionId: facts.sessionId, schoolId: facts.schoolId, groupId: facts.groupId, subjectType: 'TEACHER', subjectId: facts.teacherId, status: 'ABSENT',
              occurrenceDate: facts.occurrenceDate, scheduledStart: facts.scheduledStart, actorUserId: SYSTEM_ACTOR_ID, actorRole: 'SYSTEM', clock: this.clock,
            });
            if (!(await this.attendance.insertIfAbsent(record, tx))) throw new ConcurrentInsert();
            await this.outbox.publishFrom(record, tx);
            return 'RECORDED';
          }
          if (!overridePresent || existing.snapshot.status === 'ABSENT') return 'UNCHANGED';
          const correction = existing.correct({ status: 'ABSENT', reason: SYSTEM_CANCELLATION_REASON, actorUserId: SYSTEM_ACTOR_ID, actorRole: 'SYSTEM', clock: this.clock });
          if (!correction) return 'UNCHANGED';
          await this.attendance.applyCorrection(existing, correction, tx);
          await this.outbox.publishFrom(existing, tx);
          return 'CORRECTED';
        });
      } catch (error) {
        if (!(error instanceof ConcurrentInsert)) throw error;
        if (attempt >= MAX_ATTEMPTS) throw attendanceError('ATTENDANCE_CONCURRENT_CHANGE');
      }
    }
  }

  // ------------------------------------------------------------------------------------------ reads

  /**
   * A session's attendance: the Teacher's record and the students' records (unmarked students simply have no record). Only the Teacher assigned to the session
   * or the School Manager of its school (the route guard already checked the role and scope).
   */
  async getSessionAttendance(sessionId: string, userId: string, tx?: TransactionContext): Promise<SessionAttendanceDto> {
    const session = await this.sessions.getSession(sessionId);
    const teacher = await this.teachers.findByUserId(userId, tx);
    const isSessionTeacher = teacher !== undefined && teacher.id === session.teacherId;
    if (!isSessionTeacher && !(await this.schools.isSchoolManager(userId, session.schoolId, tx))) throw attendanceError('ATTENDANCE_READ_NOT_ALLOWED');
    const records = (await this.attendance.listBySession(sessionId, tx)).map(toAttendanceDto);
    return { sessionId, teacher: records.find((r) => r.subjectType === 'TEACHER') ?? null, students: records.filter((r) => r.subjectType === 'STUDENT') };
  }

  /** A student's attendance over time (the route guard allows the School Manager of the school and the student's own Parent). Newest session first by default. */
  async listStudentAttendance(studentId: string, input: AttendanceListInput, tx?: TransactionContext): Promise<PageResult<AttendanceRecordDto>> {
    const { items, total } = await this.attendance.listByStudent(studentId, input.direction ?? 'desc', input.page, tx);
    return buildPageResult(items.map(toAttendanceDto), total, input.page);
  }

  /** The correction history of a session (append-only). Used by tests now and by the History & Audit module (35) later; no endpoint exposes it yet. */
  listCorrectionsOfSession(sessionId: string, tx?: TransactionContext): Promise<AttendanceCorrection[]> {
    return this.attendance.listCorrectionsOfSession(sessionId, tx);
  }

  /** The group of a session (the routes authorize against it). Module 24's NOT_FOUND for an unknown session. */
  findGroupIdOfSession(sessionId: string): Promise<string> {
    return this.sessions.findGroupIdOf(sessionId);
  }

  // ------------------------------------------------------------------------------------------ internals

  /** Smart Guard for a protected Teacher action. The Teacher comes from the verified user id; a user who is not a Teacher is refused like any other non-owner. */
  private async guard(sessionId: string, userId: string, gps: unknown): Promise<ClassSessionDto> {
    const teacher = await this.teachers.findByUserId(userId);
    if (!teacher) throw smartGuardError('SMART_GUARD_NOT_SESSION_TEACHER');
    await this.smartGuard.check({ teacherId: teacher.id, sessionId, gps });
    return this.sessions.getSession(sessionId);
  }

  /** The session for a School Manager action: it must exist and must not be cancelled. */
  private async openSession(sessionId: string): Promise<ClassSessionDto> {
    const session = await this.sessions.getSession(sessionId);
    if (session.status === 'CANCELLED') throw attendanceError('ATTENDANCE_SESSION_CANCELLED');
    return session;
  }

  /** Is every one of these students currently assigned to the session's group? (Module 20's assignment history: the open assignment is the current one.) */
  private async assertCurrentlyAssigned(groupId: string, studentIds: readonly string[]): Promise<void> {
    const missing: string[] = [];
    for (const studentId of studentIds) {
      const history = await this.groups.listAssignmentHistoryOfStudent(studentId);
      if (!history.some((a) => a.groupId === groupId && a.unassignedAt === null)) missing.push(studentId);
    }
    if (missing.length > 0) throw attendanceError('ATTENDANCE_STUDENT_NOT_IN_GROUP', { studentIds: missing });
  }

  /**
   * Plans every change first (so ANY invalid item rejects the whole request before anything is written), then writes them all in ONE transaction: a first marking
   * creates the record (AttendanceRecorded); a different status on an existing record is a correction (reason required, history entry, AttendanceCorrected); the same
   * status changes nothing. A concurrent insert of the same (session, subject) rolls everything back and the operation is retried (up to 3 attempts).
   */
  private async apply(
    session: ClassSessionDto,
    actor: { userId: string; role: ActorRole },
    subjectType: SubjectType,
    changes: readonly Change[],
    roster: 'ALL' | 'NEW_ONLY' | 'NONE',
  ): Promise<AttendanceBatchResultDto> {
    if (session.status === 'CANCELLED') throw attendanceError('ATTENDANCE_SESSION_CANCELLED');
    if (roster === 'ALL') await this.assertCurrentlyAssigned(session.groupId, changes.map((c) => c.subjectId));
    for (let attempt = 1; ; attempt += 1) {
      try {
        const results = await this.unitOfWork.run(async (tx) => {
          const existing = new Map((await this.attendance.lockSubjects(session.id, subjectType, changes.map((c) => c.subjectId), tx)).map((r) => [r.snapshot.subjectId, r]));
          if (roster === 'NEW_ONLY') await this.assertCurrentlyAssigned(session.groupId, changes.filter((c) => !existing.has(c.subjectId)).map((c) => c.subjectId));

          // Phase 1: plan (pure). Any error here leaves nothing written.
          const planned = changes.map((change) => {
            const current = existing.get(change.subjectId);
            if (!current) {
              const record = AttendanceRecord.record({
                sessionId: session.id, schoolId: session.schoolId, groupId: session.groupId, subjectType, subjectId: change.subjectId, status: change.status,
                occurrenceDate: session.occurrenceDate, scheduledStart: session.scheduledStart, actorUserId: actor.userId, actorRole: actor.role, clock: this.clock,
              });
              return { change, record, correction: undefined as AttendanceCorrection | undefined, isNew: true };
            }
            const correction = current.correct({ status: change.status, reason: change.reason, actorUserId: actor.userId, actorRole: actor.role, clock: this.clock });
            return { change, record: current, correction, isNew: false };
          });

          // Phase 2: write (one transaction).
          const out: AttendanceChangeResultDto[] = [];
          for (const p of planned) {
            if (p.isNew) {
              if (!(await this.attendance.insertIfAbsent(p.record, tx))) throw new ConcurrentInsert();
              await this.outbox.publishFrom(p.record, tx);
              out.push({ subjectId: p.change.subjectId, outcome: 'RECORDED', record: toAttendanceDto(p.record) });
            } else if (p.correction) {
              await this.attendance.applyCorrection(p.record, p.correction, tx);
              await this.outbox.publishFrom(p.record, tx);
              out.push({ subjectId: p.change.subjectId, outcome: 'CORRECTED', record: toAttendanceDto(p.record) });
            } else {
              out.push({ subjectId: p.change.subjectId, outcome: 'UNCHANGED', record: toAttendanceDto(p.record) });
            }
          }
          return out;
        });
        return { sessionId: session.id, results };
      } catch (error) {
        if (!(error instanceof ConcurrentInsert)) throw error;
        if (attempt >= MAX_ATTEMPTS) throw attendanceError('ATTENDANCE_CONCURRENT_CHANGE');
      }
    }
  }
}

function parseStatus(value: unknown): AttendanceStatus {
  if (!isAttendanceStatus(value)) throw attendanceError('ATTENDANCE_INVALID_STATUS');
  return value;
}

/** Validates the batch before anything else: 1..200 records, each `{ studentId, status, reason? }`, no student twice. */
function parseStudentChanges(records: unknown): Change[] {
  if (!Array.isArray(records) || records.length === 0) throw attendanceError('ATTENDANCE_RECORDS_REQUIRED');
  if (records.length > MAX_BATCH_RECORDS) throw attendanceError('ATTENDANCE_TOO_MANY_RECORDS', { max: MAX_BATCH_RECORDS }, { max: MAX_BATCH_RECORDS });
  const seen = new Set<string>();
  return records.map((item: unknown) => {
    const rec = (typeof item === 'object' && item !== null ? item : {}) as Record<string, unknown>;
    if (typeof rec.studentId !== 'string' || rec.studentId.trim() === '') throw attendanceError('ATTENDANCE_INVALID_RECORD');
    const status = parseStatus(rec.status);
    if (seen.has(rec.studentId)) throw attendanceError('ATTENDANCE_DUPLICATE_STUDENT', { studentId: rec.studentId });
    seen.add(rec.studentId);
    return { subjectId: rec.studentId, status, reason: rec.reason };
  });
}
