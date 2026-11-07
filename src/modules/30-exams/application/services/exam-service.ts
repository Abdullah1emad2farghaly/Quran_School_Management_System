import { SystemClock, buildPageResult, type Clock, type PageRequest, type PageResult, type TransactionContext, type UnitOfWork } from '../../../00-shared-kernel/public';
import type { OutboxService } from '../../../06-domain-events-outbox/public';
import type { ParentLookup } from '../../../17-parents/public';
import type { TeacherLookup } from '../../../18-teachers/public';
import type { GroupService } from '../../../20-groups/public';
import { roundScore } from '../../../29-evaluations/public';
import type { SmartGuard } from '../../../25-smart-guard/public';
import { Exam, type ExamConfigInput } from '../../domain/entities/exam';
import { ExamResult } from '../../domain/entities/exam-result';
import { examError } from '../../domain/errors/exam-errors';
import { EXAM_REMINDER_HOURS, EXAM_SMART_GUARD_LEAD_MINUTES, type ExamStatus } from '../../domain/value-objects/exam-rules';
import {
  maxTotalOf, toExamDto, toPendingStudentDto, toResultDto, toScheduleDto, type ExamDto, type ExamReminderStatusDto, type ExamResultReceiptDto, type ExamResultsDto, type ExamScheduleDto, type PendingGroupDto,
  type PendingStudentDto, type StudentExamOutcomeDto,
} from '../dto/exam-dto';
import type { ExamRepository, ExamStudentRow } from '../ports/exam-repository';
import { EXAMINER_VISIBLE_STATUSES, type ExamScope } from './exam-authorization';

export interface ExamServiceDeps {
  readonly exams: ExamRepository;
  /** Module 25: result recording goes through its exam-compatible entry point (`checkProtectedAction`). */
  readonly smartGuard: Pick<SmartGuard, 'checkProtectedAction'>;
  /** Module 18: examiners must be Teachers registered in the exam's school. */
  readonly teachers: Pick<TeacherLookup, 'findById' | 'findByUserId'>;
  /** Module 20: the groups and their CURRENT students (the target list). */
  readonly groups: Pick<GroupService, 'listGroupsOfSchool' | 'listStudentsOfGroup' | 'findScopeById'>;
  readonly parents: Pick<ParentLookup, 'findByUserId' | 'listActiveSchoolIds'>;
  readonly unitOfWork: UnitOfWork;
  readonly outbox: OutboxService;
  readonly clock?: Clock;
}

export interface CreateExamInput {
  readonly schoolId: string;
  readonly startAt: Date;
  readonly endAt?: Date | null;
  readonly questionCount: number;
  readonly maxScore: number;
  readonly wholeSchool?: boolean;
  readonly groupIds?: readonly string[];
  readonly examinerTeacherIds?: readonly string[];
}

export interface UpdateExamInput {
  readonly startAt?: Date;
  readonly endAt?: Date | null;
  readonly questionCount?: number;
  readonly maxScore?: number;
  readonly wholeSchool?: boolean;
  readonly groupIds?: readonly string[];
}

export interface SubmitExamResultInput {
  readonly studentId: string;
  /** One score per question, in the order of the questions. */
  readonly scores: unknown;
  /** `{ latitude, longitude, accuracyMeters }`: validated by Smart Guard. */
  readonly gps: unknown;
}

export interface ListExamsInput {
  readonly statuses?: readonly ExamStatus[];
  readonly page: PageRequest;
}

const ROSTER_PAGE_SIZE = 100;
const CYCLE_LIMIT = 200;
class ConcurrentInsert extends Error {}
const asPage = (items: unknown[], total: number, page: PageRequest) => buildPageResult(items, total, page);

interface LiveTarget {
  readonly groupId: string;
  readonly groupName: string;
  readonly studentId: string;
  readonly fullName: string;
}

/**
 * Public application contract of Module 30 (Exams, Master Specification §53-57 as amended by the approved Module 30 decisions; docs/EXAMS.md).
 *
 *  - LIFECYCLE: DRAFT -> SCHEDULED -> STARTED (automatic at the start time, the target list is FROZEN) -> COMPLETED (automatic at the end time, or manual when there is no end time;
 *    every unexamined target becomes ABSENT, no score is invented) -> ENDED (manual, final, releases the examiners' exam-scoped permission). CANCELLED only from DRAFT or SCHEDULED.
 *    Deletion (a separate operation) only while DRAFT or SCHEDULED. After STARTED only the end time (future only) and the examiners can change.
 *  - TARGETS: before STARTED the list is computed LIVE from the groups' current students (so it can never drift); STARTED stores it. Later group changes never touch it.
 *  - RESULTS: only an examiner currently assigned to the exam records them, ONLY while STARTED, through Smart Guard, one student per request with ALL the question scores in one atomic
 *    operation; first wins on a concurrent submission; immutable for everyone, forever. No pass mark, percentage or ranking.
 *  - READS: the School Manager reads everything of their school; an examiner reads their exams and the PENDING students (never any result); a Parent reads the schedule and only their
 *    own children's recorded results or ABSENT status. Nothing is notified here: events and reads feed the Notifications modules (31-34).
 * Concurrency: every change and transition takes the exam row `FOR UPDATE`; a result submission takes it `FOR SHARE` (submissions run in parallel, never while a change or the
 * completion holds the exam) and then the student's row.
 */
export class ExamService {
  private readonly repo: ExamRepository;
  private readonly smartGuard: ExamServiceDeps['smartGuard'];
  private readonly teachers: ExamServiceDeps['teachers'];
  private readonly groups: ExamServiceDeps['groups'];
  private readonly parents: ExamServiceDeps['parents'];
  private readonly unitOfWork: UnitOfWork;
  private readonly outbox: OutboxService;
  private readonly clock: Clock;

  constructor(deps: ExamServiceDeps) {
    this.repo = deps.exams;
    this.smartGuard = deps.smartGuard;
    this.teachers = deps.teachers;
    this.groups = deps.groups;
    this.parents = deps.parents;
    this.unitOfWork = deps.unitOfWork;
    this.outbox = deps.outbox;
    this.clock = deps.clock ?? new SystemClock();
  }

  // ------------------------------------------------------------------------------------------ the School Manager: configuration and lifecycle

  /** Creates an exam in DRAFT. Any number of exams at any time. The route guard already proved the caller manages `input.schoolId`. */
  async createExam(actorUserId: string, input: CreateExamInput): Promise<ExamDto> {
    const wholeSchool = input.wholeSchool === true;
    const groupIds = wholeSchool ? [] : [...(input.groupIds ?? [])];
    const examinerTeacherIds = [...new Set(input.examinerTeacherIds ?? [])];
    return this.unitOfWork.run(async (tx) => {
      await this.assertTargetGroups(input.schoolId, groupIds, tx);
      await this.assertEligibleExaminers(input.schoolId, examinerTeacherIds, tx);
      const exam = Exam.create({ schoolId: input.schoolId, wholeSchool, groupIds, startAt: input.startAt, endAt: input.endAt ?? null, questionCount: input.questionCount, maxScore: input.maxScore, examinerTeacherIds, actorId: actorUserId, clock: this.clock });
      await this.repo.insert(exam, tx);
      await this.outbox.publishFrom(exam, tx);
      return toExamDto(exam);
    });
  }

  /** DRAFT and SCHEDULED: any configuration field. After STARTED the configuration is locked (the end time has its own operation). */
  updateExam(examId: string, actorUserId: string, patch: UpdateExamInput): Promise<ExamDto> {
    return this.mutate(examId, async (exam, tx) => {
      const groupIds = patch.groupIds === undefined ? undefined : patch.wholeSchool === true ? [] : [...patch.groupIds];
      const config: Partial<ExamConfigInput> = {
        ...(patch.startAt !== undefined ? { startAt: patch.startAt } : {}), ...(patch.endAt !== undefined ? { endAt: patch.endAt } : {}),
        ...(patch.questionCount !== undefined ? { questionCount: patch.questionCount } : {}), ...(patch.maxScore !== undefined ? { maxScore: patch.maxScore } : {}),
        ...(patch.wholeSchool !== undefined ? { wholeSchool: patch.wholeSchool } : {}), ...(groupIds !== undefined ? { groupIds } : {}),
      };
      exam.updateConfiguration(config, actorUserId, this.clock);
      const s = exam.snapshot;
      await this.assertTargetGroups(s.schoolId, s.groupIds, tx);
    });
  }

  scheduleExam(examId: string, actorUserId: string): Promise<ExamDto> {
    return this.mutate(examId, async (exam, tx) => {
      exam.schedule(actorUserId, this.clock);
      await this.assertTargetGroups(exam.snapshot.schoolId, exam.snapshot.groupIds, tx);
    });
  }

  /** Cancellation (before STARTED only; a separate operation from deletion). */
  cancelExam(examId: string, actorUserId: string): Promise<ExamDto> {
    return this.mutate(examId, async (exam) => exam.cancel(actorUserId, this.clock));
  }

  /** Deletion (before STARTED only). The exam disappears from every read; its record is kept. */
  async deleteExam(examId: string, actorUserId: string): Promise<void> {
    await this.mutate(examId, async (exam) => exam.markDeleted(actorUserId, this.clock));
  }

  /** While STARTED the end time can be extended or reduced to a time strictly in the future; the start time is immutable. */
  changeEndTime(examId: string, actorUserId: string, endAt: Date): Promise<ExamDto> {
    return this.mutate(examId, async (exam) => exam.changeEndTime(endAt, actorUserId, this.clock));
  }

  /** The School Manager completes an exam that has NO end time. (With an end time the system completes it at that time.) */
  completeExam(examId: string, actorUserId: string): Promise<ExamDto> {
    return this.mutate(examId, async (exam, tx) => {
      const s = exam.snapshot;
      if (s.status !== 'STARTED') throw examError('EXAM_INVALID_TRANSITION', { status: s.status });
      if (s.endAt !== null) throw examError('EXAM_END_TIME_DEFINED');
      await this.completeInside(exam, actorUserId, tx);
    });
  }

  /** The final, one-way closure (only after COMPLETED). Releases every examiner's exam-scoped permission; preserves every record. */
  endExam(examId: string, actorUserId: string): Promise<ExamDto> {
    return this.mutate(examId, async (exam) => exam.end(actorUserId, this.clock));
  }

  /** The School Manager may add an examiner until the exam ENDED. The examiner must be a Teacher registered in the exam's school. */
  assignExaminer(examId: string, actorUserId: string, teacherId: string): Promise<ExamDto> {
    return this.mutate(examId, async (exam, tx) => {
      await this.assertEligibleExaminers(exam.snapshot.schoolId, [teacherId], tx);
      exam.assignExaminer(teacherId, actorUserId, this.clock);
    });
  }

  /** Removing an examiner never touches results already recorded; the examiner can no longer submit new ones. */
  removeExaminer(examId: string, actorUserId: string, teacherId: string): Promise<ExamDto> {
    return this.mutate(examId, async (exam) => exam.removeExaminer(teacherId, actorUserId, this.clock));
  }

  // ------------------------------------------------------------------------------------------ the assigned examiner: results (Smart Guard)

  /**
   * Records ONE student's result: every question score, atomically (nothing is stored on any failure). Only a currently assigned examiner, only while the exam is STARTED and before
   * its end, only through Smart Guard + GPS, only for a student of the frozen target list who has no result yet. Two concurrent submissions for the same student: the first
   * atomic transaction wins, the other gets EXAM_RESULT_ALREADY_RECORDED. Rounds each score to two decimals; the total is the exact sum.
   */
  async submitResult(examId: string, userId: string, input: SubmitExamResultInput): Promise<ExamResultReceiptDto> {
    const teacher = await this.teachers.findByUserId(userId);
    if (!teacher) throw examError('EXAM_NOT_EXAMINER');
    // The lifecycle is also driven on demand, so a submission arriving just after the start does not wait for the next scheduler tick.
    await this.advanceExam(examId);
    const known = await this.repo.findById(examId);
    if (!known) throw examError('EXAM_NOT_FOUND');
    if (!known.isActiveExaminer(teacher.id)) throw examError('EXAM_NOT_EXAMINER');
    if (typeof input.studentId !== 'string' || input.studentId.trim() === '') throw examError('EXAM_INVALID_SCORES');
    // Smart Guard (the exam-compatible entry point): the examiner owns the action, the window is 15 minutes before the start through the effective end.
    const s = known.snapshot;
    await this.smartGuard.checkProtectedAction({
      teacherId: teacher.id, schoolId: s.schoolId, gps: input.gps,
      window: { opensAt: new Date(s.startAt.getTime() - EXAM_SMART_GUARD_LEAD_MINUTES * 60_000), closesAt: s.endAt },
    });

    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.unitOfWork.run(async (tx): Promise<ExamResultReceiptDto> => {
          const exam = await this.repo.lockById(examId, 'SHARE', tx);
          if (!exam) throw examError('EXAM_NOT_FOUND');
          const current = exam.snapshot;
          // Re-checked UNDER the lock: an examiner removed (or released at ENDED) a moment ago can no longer submit.
          if (!exam.isActiveExaminer(teacher.id)) throw examError('EXAM_NOT_EXAMINER');
          if (current.status === 'SCHEDULED') throw examError('EXAM_NOT_STARTED');
          if (current.status !== 'STARTED') throw examError('EXAM_SUBMISSION_CLOSED', { status: current.status });
          if (current.endAt !== null && this.clock.now().getTime() > current.endAt.getTime()) throw examError('EXAM_SUBMISSION_CLOSED', { status: current.status });
          const scores = this.parseScores(input.scores, current.questionCount, current.maxScore);
          const marked = await this.repo.markStudentExamined(examId, input.studentId, tx);
          if (marked.outcome === 'MISSING') throw examError('EXAM_STUDENT_NOT_TARGET');
          if (marked.outcome !== 'OK') throw examError('EXAM_RESULT_ALREADY_RECORDED');
          const result = ExamResult.create({
            examId, schoolId: current.schoolId, groupId: marked.groupId, studentId: input.studentId, scores, maxScore: current.maxScore, examinerTeacherId: teacher.id, examinerUserId: userId, clock: this.clock,
          });
          if (!(await this.repo.insertResult(result, tx))) throw new ConcurrentInsert();
          await this.outbox.publishFrom(result, tx);
          return { examId, studentId: input.studentId, groupId: marked.groupId };
        });
      } catch (error) {
        if (!(error instanceof ConcurrentInsert)) throw error;
        if (attempt >= 3) throw examError('EXAM_CONCURRENT_CHANGE');
      }
    }
  }

  // ------------------------------------------------------------------------------------------ the system: automatic transitions

  /**
   * One pass of the background job: starts every SCHEDULED exam whose start time has been reached (freezing its target list) and completes every STARTED exam whose end time has
   * passed (marking the unexamined ABSENT). Idempotent and driven only by the stored times, so after downtime or a delayed run it simply catches up, in order. A failure in
   * one exam never blocks the others.
   */
  async runCycle(): Promise<{ started: number; completed: number; failed: number }> {
    let started = 0;
    let completed = 0;
    let failed = 0;
    const now = this.clock.now();
    const ids = [...new Set([...(await this.repo.idsDueToStart(now, CYCLE_LIMIT)), ...(await this.repo.idsDueToComplete(now, CYCLE_LIMIT))])];
    for (const id of ids) {
      try {
        const result = await this.advanceExam(id);
        if (result.started) started += 1;
        if (result.completed) completed += 1;
      } catch {
        failed += 1;
      }
    }
    return { started, completed, failed };
  }

  /** Moves ONE exam forward as far as the clock allows (start, then completion). Safe to call at any time, from anywhere, any number of times. */
  async advanceExam(examId: string): Promise<{ started: boolean; completed: boolean }> {
    const out = { started: false, completed: false };
    const peek = await this.repo.findById(examId);
    if (!peek) return out;
    const now = this.clock.now().getTime();
    const p = peek.snapshot;
    if (p.status === 'SCHEDULED' && p.startAt.getTime() <= now) {
      out.started = await this.unitOfWork.run(async (tx) => {
        const exam = await this.repo.lockById(examId, 'UPDATE', tx);
        if (!exam) return false;
        const s = exam.snapshot;
        // Re-checked under the lock: the exam may have been edited, cancelled or deleted a moment ago.
        if (s.status !== 'SCHEDULED' || s.startAt.getTime() > this.clock.now().getTime()) return false;
        const targets = await this.liveTargets(exam, tx);
        await this.repo.insertStudents(targets.map((t) => ({ examId, studentId: t.studentId, groupId: t.groupId, groupName: t.groupName, fullName: t.fullName, status: 'PENDING' as const })), tx);
        exam.start(this.clock, targets.length);
        await this.repo.save(exam, tx);
        await this.outbox.publishFrom(exam, tx);
        return true;
      });
    }
    const current = out.started ? await this.repo.findById(examId) : peek;
    const c = current?.snapshot;
    if (c && c.status === 'STARTED' && c.endAt !== null && c.endAt.getTime() < this.clock.now().getTime()) {
      out.completed = await this.unitOfWork.run(async (tx) => {
        const exam = await this.repo.lockById(examId, 'UPDATE', tx);
        if (!exam) return false;
        const s = exam.snapshot;
        // Re-checked under the lock: the Manager may have moved the end time into the future a moment ago (the end-time change and this completion are serialized by the lock).
        if (s.status !== 'STARTED' || s.endAt === null || s.endAt.getTime() >= this.clock.now().getTime()) return false;
        await this.completeInside(exam, null, tx);
        await this.repo.save(exam, tx);
        await this.outbox.publishFrom(exam, tx);
        return true;
      });
    }
    return out;
  }

  // ------------------------------------------------------------------------------------------ reads

  async getExam(examId: string, tx?: TransactionContext): Promise<ExamDto> {
    const exam = await this.repo.findById(examId, tx);
    if (!exam) throw examError('EXAM_NOT_FOUND');
    return toExamDto(exam);
  }

  async listSchoolExams(schoolId: string, input: ListExamsInput): Promise<PageResult<ExamDto>> {
    const { items, total } = await this.repo.listBySchool(schoolId, input.statuses, input.page);
    return asPage(items.map(toExamDto), total, input.page) as PageResult<ExamDto>;
  }

  /** The exams the caller is currently assigned to as an examiner (SCHEDULED, STARTED or COMPLETED; never after ENDED). */
  async listAssignedExams(userId: string, page: PageRequest): Promise<PageResult<ExamDto>> {
    const teacher = await this.teachers.findByUserId(userId);
    if (!teacher) return asPage([], 0, page) as PageResult<ExamDto>;
    const { items, total } = await this.repo.listAssignedToTeacher(teacher.id, EXAMINER_VISIBLE_STATUSES, page);
    return asPage(items.map(toExamDto), total, page) as PageResult<ExamDto>;
  }

  /** The exam schedule of the schools of the caller's children (a Parent). */
  async listParentSchedule(userId: string, page: PageRequest): Promise<PageResult<ExamScheduleDto>> {
    const parent = await this.parents.findByUserId(userId);
    if (!parent) return asPage([], 0, page) as PageResult<ExamScheduleDto>;
    const schoolIds = await this.parents.listActiveSchoolIds(parent.id);
    if (schoolIds.length === 0) return asPage([], 0, page) as PageResult<ExamScheduleDto>;
    const { items, total } = await this.repo.listScheduleOfSchools(schoolIds, page);
    return asPage(items.map(toScheduleDto), total, page) as PageResult<ExamScheduleDto>;
  }

  /** ALL the recorded results of an exam and its ABSENT students (the route restricts it to the School Manager of the school). */
  async getResults(examId: string): Promise<ExamResultsDto> {
    const exam = await this.repo.findById(examId);
    if (!exam) throw examError('EXAM_NOT_FOUND');
    const maxTotal = maxTotalOf(exam);
    const results = await this.repo.listResultsOfExam(examId);
    const absent = await this.repo.listAbsentStudents(examId);
    return {
      examId, status: exam.snapshot.status, results: results.map((r) => toResultDto(r, maxTotal)),
      absent: absent.map((a) => ({ studentId: a.studentId, groupId: a.groupId, fullName: a.fullName })),
    };
  }

  /** A student's recorded results and ABSENT statuses (the route allows the School Manager of the school and the student's own Parent). Pending and unreleased information is never included. */
  async listStudentOutcomes(studentId: string, page: PageRequest): Promise<PageResult<StudentExamOutcomeDto>> {
    const { items, total } = await this.repo.listOutcomesOfStudent(studentId, page);
    const dtos: StudentExamOutcomeDto[] = items.map((row) => {
      const s = row.exam.snapshot;
      return {
        exam: { ...toScheduleDto(row.exam), questionCount: s.questionCount, maxScore: s.maxScore },
        outcome: row.status,
        result: row.result ? { scores: [...row.result.scores], total: row.result.total, maxTotal: maxTotalOf(row.exam), recordedAt: row.result.recordedAt } : null,
      };
    });
    return asPage(dtos, total, page) as PageResult<StudentExamOutcomeDto>;
  }

  /** The target groups with how many students are still pending (DRAFT and SCHEDULED: the live list; afterwards: the frozen list). */
  async listPendingGroups(examId: string): Promise<PendingGroupDto[]> {
    const exam = await this.repo.findById(examId);
    if (!exam) throw examError('EXAM_NOT_FOUND');
    if (this.isLive(exam.snapshot.status)) {
      const by = new Map<string, PendingGroupDto>();
      for (const t of await this.liveTargets(exam)) {
        const g = by.get(t.groupId) ?? { groupId: t.groupId, groupName: t.groupName, total: 0, pending: 0 };
        by.set(t.groupId, { ...g, total: g.total + 1, pending: g.pending + 1 });
      }
      return [...by.values()];
    }
    return (await this.repo.listGroupsWithCounts(examId)).map((g) => ({ groupId: g.groupId, groupName: g.groupName, total: g.total, pending: g.pending }));
  }

  /** The students of ONE group who have not been examined yet (never a flat list of all the groups). */
  async listPendingStudents(examId: string, groupId: string, page: PageRequest): Promise<PageResult<PendingStudentDto>> {
    const exam = await this.repo.findById(examId);
    if (!exam) throw examError('EXAM_NOT_FOUND');
    if (this.isLive(exam.snapshot.status)) {
      const all = (await this.liveTargets(exam)).filter((t) => t.groupId === groupId);
      const rows: ExamStudentRow[] = all.map((t) => ({ examId, studentId: t.studentId, groupId: t.groupId, groupName: t.groupName, fullName: t.fullName, status: 'PENDING' }));
      const start = (page.page - 1) * page.pageSize;
      return asPage(rows.slice(start, start + page.pageSize).map(toPendingStudentDto), rows.length, page) as PageResult<PendingStudentDto>;
    }
    const { items, total } = await this.repo.listPendingStudents(examId, groupId, page);
    return asPage(items.map(toPendingStudentDto), total, page) as PageResult<PendingStudentDto>;
  }

  /** The integration data for the 24-hour reminder (the Notifications modules deliver it; nothing is sent here). It creates and changes nothing. */
  async getExamReminderStatus(examId: string): Promise<ExamReminderStatusDto> {
    const exam = await this.repo.findById(examId);
    if (!exam) throw examError('EXAM_NOT_FOUND');
    const s = exam.snapshot;
    return { examId, schoolId: s.schoolId, status: s.status, startAt: s.startAt, reminderDueAt: new Date(s.startAt.getTime() - EXAM_REMINDER_HOURS * 3_600_000), examinerTeacherIds: exam.activeExaminerIds };
  }

  /** What the Authorization Engine needs to decide a scope (server-side data only). */
  async findScopeById(examId: string): Promise<ExamScope | undefined> {
    const exam = await this.repo.findById(examId);
    if (!exam) return undefined;
    const s = exam.snapshot;
    return { id: s.id, schoolId: s.schoolId, status: s.status, examinerTeacherIds: exam.activeExaminerIds };
  }

  // ------------------------------------------------------------------------------------------ group membership (before STARTED)

  /**
   * Module 20 published that a student joined or left a group. Before STARTED the target list is computed live, so nothing needs to be synchronized; this only publishes
   * ExamStudentTargeted / ExamStudentUntargeted for the SCHEDULED exams that target the group, so the Notifications modules can tell the parent of a student added after
   * scheduling. A move inside a whole-school exam is not a change of target (a MOVED unassignment is ignored for it). Delivery is at least once: consumers de-duplicate.
   */
  async onGroupMembershipChanged(change: { kind: 'ASSIGNED' | 'UNASSIGNED'; schoolId: string; groupId: string; studentId: string; reason?: string }): Promise<number> {
    return this.unitOfWork.run(async (tx) => {
      const exams = await this.repo.listScheduledCoveringGroup(change.schoolId, change.groupId, tx);
      let published = 0;
      for (const exam of exams) {
        if (change.kind === 'UNASSIGNED' && change.reason === 'MOVED' && exam.snapshot.wholeSchool) continue;
        exam.recordTargetChange(change.kind === 'ASSIGNED' ? 'TARGETED' : 'UNTARGETED', change.studentId, change.groupId, this.clock);
        await this.outbox.publishFrom(exam, tx);
        published += 1;
      }
      return published;
    });
  }

  // ------------------------------------------------------------------------------------------ internals

  private isLive(status: ExamStatus): boolean {
    return status === 'DRAFT' || status === 'SCHEDULED';
  }

  /** The common shape of every change: lock the exam, apply it, save, publish, answer with the exam as it is afterwards. A concurrent change simply waits on the lock. */
  private mutate(examId: string, apply: (exam: Exam, tx: TransactionContext) => Promise<void>): Promise<ExamDto> {
    return this.unitOfWork.run(async (tx) => {
      const exam = await this.repo.lockById(examId, 'UPDATE', tx);
      if (!exam) throw examError('EXAM_NOT_FOUND');
      await apply(exam, tx);
      await this.repo.save(exam, tx);
      await this.outbox.publishFrom(exam, tx);
      return toExamDto(exam);
    });
  }

  /** STARTED -> COMPLETED inside the caller's transaction (the exam is locked FOR UPDATE): every pending student becomes ABSENT, nothing else about results. */
  private async completeInside(exam: Exam, actorId: string | null, tx: TransactionContext): Promise<void> {
    const absent = await this.repo.markPendingAbsent(exam.snapshot.id, tx);
    exam.complete(this.clock, absent, actorId);
  }

  private parseScores(raw: unknown, questionCount: number, maxScore: number): number[] {
    if (!Array.isArray(raw) || raw.length !== questionCount) throw examError('EXAM_INVALID_SCORES', { questionCount }, { count: questionCount });
    return raw.map((value: unknown, index) => {
      if (typeof value !== 'number' || !Number.isFinite(value)) throw examError('EXAM_INVALID_SCORES', { questionCount }, { count: questionCount });
      // 0 <= score <= maximum, judged on the submitted value (like Module 29); then rounded to two decimals.
      if (value < 0 || value > maxScore) throw examError('EXAM_SCORE_OUT_OF_RANGE', { question: index + 1, maxScore }, { question: index + 1, max: maxScore });
      return roundScore(value);
    });
  }

  private async assertTargetGroups(schoolId: string, groupIds: readonly string[], tx?: TransactionContext): Promise<void> {
    const invalid: string[] = [];
    for (const groupId of groupIds) {
      const group = await this.groups.findScopeById(groupId, tx);
      if (!group || group.schoolId !== schoolId || group.status !== 'ACTIVE') invalid.push(groupId);
    }
    if (invalid.length > 0) throw examError('EXAM_INVALID_TARGET', { groupIds: invalid });
  }

  /** An examiner must be a Teacher registered in the SAME school as the exam (a Teacher of another school is not eligible, even in the same organization). A School Manager qualifies only as such a Teacher. */
  private async assertEligibleExaminers(schoolId: string, teacherIds: readonly string[], tx?: TransactionContext): Promise<void> {
    const ineligible: string[] = [];
    for (const teacherId of teacherIds) {
      const teacher = await this.teachers.findById(teacherId, tx);
      if (!teacher || !teacher.schoolIds.includes(schoolId)) ineligible.push(teacherId);
    }
    if (ineligible.length > 0) throw examError('EXAM_EXAMINER_NOT_ELIGIBLE', { teacherIds: ineligible });
  }

  /** The students of the targeted groups RIGHT NOW (whole school: every ACTIVE group of the school), each with their group. Reads inside the caller's transaction when given one. */
  private async liveTargets(exam: Exam, tx?: TransactionContext): Promise<LiveTarget[]> {
    const s = exam.snapshot;
    const groups: Array<{ id: string; name: string }> = [];
    for (let page = 1; ; page += 1) {
      const batch = await this.groups.listGroupsOfSchool(s.schoolId, { status: ['ACTIVE'], page: { page, pageSize: ROSTER_PAGE_SIZE } }, tx);
      groups.push(...batch.items.map((g) => ({ id: g.id, name: g.name })));
      if (groups.length >= batch.total || batch.items.length === 0) break;
    }
    const wanted = s.wholeSchool ? groups : groups.filter((g) => s.groupIds.includes(g.id));
    const out: LiveTarget[] = [];
    for (const group of wanted) {
      for (let page = 1; ; page += 1) {
        const batch = await this.groups.listStudentsOfGroup(group.id, { page, pageSize: ROSTER_PAGE_SIZE }, 'asc', tx);
        out.push(...batch.items.map((st) => ({ groupId: group.id, groupName: group.name, studentId: st.studentId, fullName: st.fullName })));
        if (batch.items.length === 0 || (page - 1) * ROSTER_PAGE_SIZE + batch.items.length >= batch.total) break;
      }
    }
    return out;
  }
}

