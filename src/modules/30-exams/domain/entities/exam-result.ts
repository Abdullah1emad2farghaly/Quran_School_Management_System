import { AggregateRoot, newUuid, type Clock } from '../../../00-shared-kernel/public';
import { createDomainEvent } from '../../../06-domain-events-outbox/public';
import { EXAM_RESULT_AGGREGATE_TYPE, ExamEventTypes, type ExamResultEventPayload } from '../events/exam-events';
import { fromHundredths, toHundredths, totalOf } from '../value-objects/exam-rules';

export interface ExamResultSnapshot {
  readonly id: string;
  readonly examId: string;
  readonly schoolId: string;
  readonly groupId: string;
  readonly studentId: string;
  /** One score per question, in the order of the questions (rounded to two decimals). */
  readonly scores: readonly number[];
  readonly total: number;
  readonly examinerTeacherId: string;
  readonly examinerUserId: string;
  readonly recordedAt: Date;
}

/**
 * One student's result of one exam (approved Module 30 decisions): all the question scores, recorded once, in one atomic operation. It is IMMUTABLE under every circumstance: this
 * class has no method that changes it, and nothing in the module updates or deletes a result. The total is the exact sum of the question scores; there is no pass mark,
 * percentage or ranking.
 */
export class ExamResult extends AggregateRoot<string> {
  private constructor(private readonly state: ExamResultSnapshot) {
    super(state.id);
  }

  static create(input: { examId: string; schoolId: string; groupId: string; studentId: string; scores: readonly number[]; maxScore: number; examinerTeacherId: string; examinerUserId: string; clock: Clock }): ExamResult {
    const scores = input.scores.map((s) => fromHundredths(toHundredths(s)));
    const result = new ExamResult({
      id: newUuid(), examId: input.examId, schoolId: input.schoolId, groupId: input.groupId, studentId: input.studentId, scores, total: totalOf(scores),
      examinerTeacherId: input.examinerTeacherId, examinerUserId: input.examinerUserId, recordedAt: input.clock.now(),
    });
    result.addDomainEvent(
      createDomainEvent<ExamResultEventPayload>(
        {
          eventType: ExamEventTypes.RESULT_RECORDED,
          aggregateType: EXAM_RESULT_AGGREGATE_TYPE,
          aggregateId: result.state.id,
          payload: {
            examId: input.examId, resultId: result.state.id, schoolId: input.schoolId, groupId: input.groupId, studentId: input.studentId, scores, total: result.state.total,
            maxTotal: fromHundredths(toHundredths(input.maxScore) * scores.length), actorId: input.examinerUserId,
          },
        },
        input.clock,
      ),
    );
    return result;
  }

  static rehydrate(snapshot: ExamResultSnapshot): ExamResult {
    return new ExamResult(snapshot);
  }

  get snapshot(): ExamResultSnapshot {
    return this.state;
  }
}
