import { AggregateRoot, newUuid, type Clock } from '../../../00-shared-kernel/public';
import { createDomainEvent } from '../../../06-domain-events-outbox/public';
import { examError } from '../errors/exam-errors';
import { EXAM_AGGREGATE_TYPE, ExamEventTypes, type ExamEventPayload, type ExamEventType } from '../events/exam-events';
import { isValidQuestionCount, parseMaxScore, MAX_TARGET_GROUPS, type ExamStatus } from '../value-objects/exam-rules';

export interface ExaminerAssignment {
  readonly teacherId: string;
  readonly assignedAt: Date;
  readonly assignedBy: string;
  /** null while the examiner is currently assigned. */
  readonly releasedAt: Date | null;
  /** REMOVED (by the School Manager) or EXAM_ENDED (the exam-scoped permission is removed when the exam ends). */
  readonly releaseReason: 'REMOVED' | 'EXAM_ENDED' | null;
}

export interface ExamSnapshot {
  readonly id: string;
  readonly schoolId: string;
  readonly wholeSchool: boolean;
  /** Empty for a whole-school exam. */
  readonly groupIds: readonly string[];
  readonly startAt: Date;
  readonly endAt: Date | null;
  readonly questionCount: number;
  /** ONE uniform maximum score for every question. */
  readonly maxScore: number;
  readonly status: ExamStatus;
  readonly examiners: readonly ExaminerAssignment[];
  readonly createdBy: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly scheduledAt: Date | null;
  readonly startedAt: Date | null;
  readonly completedAt: Date | null;
  readonly endedAt: Date | null;
  readonly cancelledAt: Date | null;
  readonly deletedAt: Date | null;
}

export interface ExamConfigInput {
  readonly wholeSchool: boolean;
  readonly groupIds: readonly string[];
  readonly startAt: Date;
  readonly endAt: Date | null;
  readonly questionCount: number;
  readonly maxScore: number;
}

/** The uniform maximum score is ROUNDED to two decimals (approved, consistently with Module 29); a value that cannot be a maximum score is kept as given so that validation refuses it. */
const normalized = (config: ExamConfigInput): ExamConfigInput => ({ ...config, maxScore: parseMaxScore(config.maxScore) ?? config.maxScore });

/** Validates the configuration of an exam (the shape, not the time relative to now): a start, an end after the start, the question setup and exactly one kind of target. */
export function validateConfig(config: ExamConfigInput): void {
  if (!(config.startAt instanceof Date) || Number.isNaN(config.startAt.getTime())) throw examError('EXAM_INVALID_START');
  if (config.endAt !== null && (!(config.endAt instanceof Date) || Number.isNaN(config.endAt.getTime()) || config.endAt.getTime() <= config.startAt.getTime())) throw examError('EXAM_INVALID_END');
  if (!isValidQuestionCount(config.questionCount)) throw examError('EXAM_INVALID_QUESTION_COUNT');
  if (parseMaxScore(config.maxScore) !== config.maxScore) throw examError('EXAM_INVALID_MAX_SCORE');
  const unique = new Set(config.groupIds);
  if (unique.size !== config.groupIds.length || config.groupIds.length > MAX_TARGET_GROUPS) throw examError('EXAM_INVALID_TARGET');
  if (config.wholeSchool ? config.groupIds.length > 0 : config.groupIds.length === 0) throw examError('EXAM_TARGET_REQUIRED');
}

/**
 * An exam of a school (Master Specification §53-57 as amended by the approved Module 30 decisions of the project owner). The aggregate owns the lifecycle and the editing rules:
 *   DRAFT, SCHEDULED     the whole configuration is editable; can be cancelled or deleted (separate operations)
 *   STARTED              the start time, the question setup and the targets are frozen; ONLY the end time (future only) and the examiners change
 *   COMPLETED            nothing changes except examiners and the final `end()`
 *   ENDED                final: nothing changes at all, every examiner's exam-scoped permission is released
 * Results are NOT part of this aggregate: they are immutable records of their own. The time rules (when the exam starts, completes) are decided by the service from the clock.
 */
export class Exam extends AggregateRoot<string> {
  private constructor(private state: ExamSnapshot) {
    super(state.id);
  }

  static create(raw: ExamConfigInput & { schoolId: string; examinerTeacherIds: readonly string[]; actorId: string; clock: Clock }): Exam {
    const input = { ...raw, ...normalized(raw) };
    validateConfig(input);
    const now = input.clock.now();
    const exam = new Exam({
      id: newUuid(), schoolId: input.schoolId, wholeSchool: input.wholeSchool, groupIds: [...input.groupIds], startAt: input.startAt, endAt: input.endAt, questionCount: input.questionCount,
      maxScore: input.maxScore, status: 'DRAFT', examiners: [], createdBy: input.actorId, createdAt: now, updatedAt: now, scheduledAt: null, startedAt: null, completedAt: null, endedAt: null, cancelledAt: null, deletedAt: null,
    });
    for (const teacherId of new Set(input.examinerTeacherIds)) exam.assignExaminer(teacherId, input.actorId, input.clock);
    return exam;
  }

  static rehydrate(snapshot: ExamSnapshot): Exam {
    return new Exam(snapshot);
  }

  get snapshot(): ExamSnapshot {
    return this.state;
  }

  isActiveExaminer(teacherId: string): boolean {
    return this.state.examiners.some((e) => e.teacherId === teacherId && e.releasedAt === null);
  }

  get activeExaminerIds(): string[] {
    return this.state.examiners.filter((e) => e.releasedAt === null).map((e) => e.teacherId);
  }

  // ------------------------------------------------------------------------------------------ configuration (DRAFT and SCHEDULED only)

  /** Changes any configuration field (all of them while DRAFT or SCHEDULED). `now` is used to keep a SCHEDULED exam's start in the future. */
  updateConfiguration(patch: Partial<ExamConfigInput>, actorId: string, clock: Clock): string[] {
    this.requireOpenForConfiguration();
    const next: ExamConfigInput = {
      wholeSchool: patch.wholeSchool ?? this.state.wholeSchool,
      groupIds: patch.groupIds ?? (patch.wholeSchool === true ? [] : this.state.groupIds),
      startAt: patch.startAt ?? this.state.startAt,
      endAt: patch.endAt === undefined ? this.state.endAt : patch.endAt,
      questionCount: patch.questionCount ?? this.state.questionCount,
      maxScore: patch.maxScore ?? this.state.maxScore,
    };
    const checked = normalized(next);
    validateConfig(checked);
    if (this.state.status === 'SCHEDULED' && checked.startAt.getTime() <= clock.now().getTime()) throw examError('EXAM_START_NOT_IN_FUTURE');
    const changed: string[] = [];
    if (checked.wholeSchool !== this.state.wholeSchool || checked.groupIds.join() !== this.state.groupIds.join()) changed.push('targets');
    if (checked.startAt.getTime() !== this.state.startAt.getTime()) changed.push('startAt');
    if ((checked.endAt?.getTime() ?? null) !== (this.state.endAt?.getTime() ?? null)) changed.push('endAt');
    if (checked.questionCount !== this.state.questionCount) changed.push('questionCount');
    if (checked.maxScore !== this.state.maxScore) changed.push('maxScore');
    if (changed.length === 0) return changed;
    this.state = { ...this.state, ...checked, groupIds: [...checked.groupIds], updatedAt: clock.now() };
    if (this.state.status === 'SCHEDULED') this.publish(ExamEventTypes.UPDATED, actorId, clock, { changedFields: changed });
    return changed;
  }

  schedule(actorId: string, clock: Clock): void {
    if (this.state.status !== 'DRAFT') throw examError('EXAM_INVALID_TRANSITION', { status: this.state.status });
    validateConfig(this.state);
    if (this.state.startAt.getTime() <= clock.now().getTime()) throw examError('EXAM_START_NOT_IN_FUTURE');
    this.state = { ...this.state, status: 'SCHEDULED', scheduledAt: clock.now(), updatedAt: clock.now() };
    this.publish(ExamEventTypes.SCHEDULED, actorId, clock);
  }

  /** Cancellation is only possible before STARTED, whatever permission the caller has. */
  cancel(actorId: string, clock: Clock): void {
    if (this.state.status !== 'DRAFT' && this.state.status !== 'SCHEDULED') throw examError('EXAM_INVALID_TRANSITION', { status: this.state.status });
    const wasScheduled = this.state.status === 'SCHEDULED';
    this.state = { ...this.state, status: 'CANCELLED', cancelledAt: clock.now(), updatedAt: clock.now() };
    this.publish(ExamEventTypes.CANCELLED, actorId, clock, { wasScheduled });
  }

  /** Deletion (a separate operation from cancellation) is only possible while the exam has not started. The record is kept, hidden from every read. */
  markDeleted(actorId: string, clock: Clock): void {
    if (this.state.status !== 'DRAFT' && this.state.status !== 'SCHEDULED') throw examError('EXAM_INVALID_TRANSITION', { status: this.state.status });
    const wasScheduled = this.state.status === 'SCHEDULED';
    this.state = { ...this.state, deletedAt: clock.now(), updatedAt: clock.now() };
    this.publish(ExamEventTypes.DELETED, actorId, clock, { wasScheduled });
  }

  // ------------------------------------------------------------------------------------------ the lifecycle after scheduling

  /** SCHEDULED -> STARTED at the scheduled start (the caller froze the target list in the same transaction). */
  start(clock: Clock, frozenStudentCount: number): void {
    if (this.state.status !== 'SCHEDULED') throw examError('EXAM_INVALID_TRANSITION', { status: this.state.status });
    this.state = { ...this.state, status: 'STARTED', startedAt: clock.now(), updatedAt: clock.now() };
    this.publish(ExamEventTypes.STARTED, null, clock, { frozenStudentCount });
  }

  /** While STARTED the end time can be extended or reduced, never cleared, and always to a time strictly in the future (and after the start). */
  changeEndTime(newEnd: Date, actorId: string, clock: Clock): void {
    if (this.state.status !== 'STARTED') throw examError(this.isFinal() ? 'EXAM_LOCKED' : 'EXAM_END_TIME_NOT_EDITABLE', { status: this.state.status });
    if (!(newEnd instanceof Date) || Number.isNaN(newEnd.getTime())) throw examError('EXAM_INVALID_END');
    if (newEnd.getTime() <= clock.now().getTime() || newEnd.getTime() <= this.state.startAt.getTime()) throw examError('EXAM_END_NOT_IN_FUTURE');
    this.state = { ...this.state, endAt: newEnd, updatedAt: clock.now() };
    this.publish(ExamEventTypes.END_TIME_CHANGED, actorId, clock, { changedFields: ['endAt'] });
  }

  /** STARTED -> COMPLETED. The caller marked every unexamined target ABSENT in the same transaction (no score is invented). */
  complete(clock: Clock, absentStudentIds: readonly string[], actorId: string | null): void {
    if (this.state.status !== 'STARTED') throw examError('EXAM_INVALID_TRANSITION', { status: this.state.status });
    this.state = { ...this.state, status: 'COMPLETED', completedAt: clock.now(), updatedAt: clock.now() };
    this.publish(ExamEventTypes.COMPLETED, actorId, clock, { absentStudentIds: [...absentStudentIds] });
  }

  /** COMPLETED -> ENDED: the final, one-way closure. Every examiner's exam-scoped permission is released; nothing else changes and nothing is deleted. */
  end(actorId: string, clock: Clock): void {
    if (this.state.status !== 'COMPLETED') throw examError('EXAM_INVALID_TRANSITION', { status: this.state.status });
    const now = clock.now();
    const examiners = this.state.examiners.map((e) => (e.releasedAt === null ? { ...e, releasedAt: now, releaseReason: 'EXAM_ENDED' as const } : e));
    this.state = { ...this.state, status: 'ENDED', endedAt: now, updatedAt: now, examiners };
    this.publish(ExamEventTypes.ENDED, actorId, clock);
  }

  // ------------------------------------------------------------------------------------------ examiners (until the exam ENDED)

  assignExaminer(teacherId: string, actorId: string, clock: Clock): void {
    this.requireExaminersEditable();
    const existing = this.state.examiners.find((e) => e.teacherId === teacherId);
    if (existing && existing.releasedAt === null) throw examError('EXAM_EXAMINER_ALREADY_ASSIGNED');
    const now = clock.now();
    const assignment: ExaminerAssignment = { teacherId, assignedAt: now, assignedBy: actorId, releasedAt: null, releaseReason: null };
    this.state = { ...this.state, updatedAt: now, examiners: existing ? this.state.examiners.map((e) => (e.teacherId === teacherId ? assignment : e)) : [...this.state.examiners, assignment] };
    this.publish(ExamEventTypes.EXAMINER_ASSIGNED, actorId, clock, { teacherId });
  }

  /** Removing an examiner never touches the results already recorded; the examiner simply cannot submit new ones. */
  removeExaminer(teacherId: string, actorId: string, clock: Clock): void {
    this.requireExaminersEditable();
    if (!this.isActiveExaminer(teacherId)) throw examError('EXAM_EXAMINER_NOT_ASSIGNED');
    const now = clock.now();
    this.state = { ...this.state, updatedAt: now, examiners: this.state.examiners.map((e) => (e.teacherId === teacherId ? { ...e, releasedAt: now, releaseReason: 'REMOVED' as const } : e)) };
    this.publish(ExamEventTypes.EXAMINER_REMOVED, actorId, clock, { teacherId });
  }

  /** Publishes (changes nothing): a student joined or left a group this exam targets, before the exam started (so the parent of a student added after scheduling can be told). */
  recordTargetChange(kind: 'TARGETED' | 'UNTARGETED', studentId: string, groupId: string, clock: Clock): void {
    this.publish(kind === 'TARGETED' ? ExamEventTypes.STUDENT_TARGETED : ExamEventTypes.STUDENT_UNTARGETED, null, clock, { studentId, groupId });
  }

  // ------------------------------------------------------------------------------------------ guards

  private isFinal(): boolean {
    return this.state.status === 'COMPLETED' || this.state.status === 'ENDED';
  }

  private requireOpenForConfiguration(): void {
    const status = this.state.status;
    if (status === 'DRAFT' || status === 'SCHEDULED') return;
    if (status === 'STARTED') throw examError('EXAM_CONFIG_LOCKED', { status });
    throw examError(status === 'CANCELLED' ? 'EXAM_INVALID_TRANSITION' : 'EXAM_LOCKED', { status });
  }

  private requireExaminersEditable(): void {
    const status = this.state.status;
    if (status === 'ENDED') throw examError('EXAM_LOCKED', { status });
    if (status === 'CANCELLED') throw examError('EXAM_INVALID_TRANSITION', { status });
  }

  private publish(eventType: ExamEventType, actorId: string | null, clock: Clock, extra: Partial<ExamEventPayload> = {}): void {
    const s = this.state;
    this.addDomainEvent(
      createDomainEvent<ExamEventPayload>(
        {
          eventType,
          aggregateType: EXAM_AGGREGATE_TYPE,
          aggregateId: s.id,
          payload: { examId: s.id, schoolId: s.schoolId, status: s.status, startAt: s.startAt.toISOString(), endAt: s.endAt ? s.endAt.toISOString() : null, wholeSchool: s.wholeSchool, groupIds: [...s.groupIds], actorId, ...extra },
        },
        clock,
      ),
    );
  }
}
