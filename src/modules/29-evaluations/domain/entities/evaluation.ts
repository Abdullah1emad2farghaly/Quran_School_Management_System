import { AggregateRoot, newUuid, type Clock } from '../../../00-shared-kernel/public';
import { createDomainEvent } from '../../../06-domain-events-outbox/public';
import { evaluationError } from '../errors/evaluation-errors';
import { EVALUATION_AGGREGATE_TYPE, EvaluationEventTypes, type EvaluationEventPayload } from '../events/evaluation-events';
import { MAX_NOTE_LENGTH, sameScore, type EvaluationCategory } from '../value-objects/evaluation-rules';

export interface EvaluationScore {
  readonly category: EvaluationCategory;
  /** 0.00 to 10.00, two decimal places. */
  readonly score: number;
  /** The Module 27 assignment this score is associated with (Memorization: always; Performance and Tajweed: when one applies), else null. */
  readonly memorizationAssignmentId: string | null;
  /** The Module 28 assignment this score is associated with (Revision: always; Performance and Tajweed: when one applies), else null. */
  readonly revisionAssignmentId: string | null;
}

export interface EvaluationSnapshot {
  readonly id: string;
  readonly sessionId: string;
  readonly schoolId: string;
  readonly groupId: string;
  readonly studentId: string;
  /** Snapshot of the session at the time of recording, so a student's evaluations list by date without reading sessions. */
  readonly occurrenceDate: string;
  readonly scheduledStart: Date;
  /** The ONE optional note of the evaluation, shared by all categories. Saved once with the evaluation; never edited or deleted. */
  readonly note: string | null;
  readonly scores: readonly EvaluationScore[];
  readonly recordedBy: string;
  readonly recordedAt: Date;
  readonly updatedBy: string;
  readonly updatedAt: Date;
}

/**
 * The note of an evaluation (approved decision 5): optional, at most 200 characters, trimmed. Missing, null or blank means "no note". A non-string is invalid.
 */
export function normalizeNote(note: unknown): string | null {
  if (note === undefined || note === null) return null;
  if (typeof note !== 'string') throw evaluationError('EVALUATION_INVALID_NOTE');
  const text = note.trim();
  if (text === '') return null;
  if ([...text].length > MAX_NOTE_LENGTH) throw evaluationError('EVALUATION_NOTE_TOO_LONG', { max: MAX_NOTE_LENGTH }, { max: MAX_NOTE_LENGTH });
  return text;
}

/**
 * One student's evaluation for one session (Master Specification §52 and the approved Module 29 decisions): an independent score per available category and ONE optional
 * note. Unique per (session, student). It is created with ALL the categories available to the student; afterwards only the scores can change (while the session lasts).
 * NO history is kept: a change overwrites the score (approved decision 5), and a change publishes EvaluationScoresUpdated with the current scores only. Never deleted.
 */
export class Evaluation extends AggregateRoot<string> {
  private constructor(private state: EvaluationSnapshot) {
    super(state.id);
  }

  static create(input: {
    sessionId: string; schoolId: string; groupId: string; studentId: string; occurrenceDate: string; scheduledStart: Date; note: string | null;
    scores: readonly EvaluationScore[]; actorUserId: string; clock: Clock;
  }): Evaluation {
    const now = input.clock.now();
    const evaluation = new Evaluation({
      id: newUuid(), sessionId: input.sessionId, schoolId: input.schoolId, groupId: input.groupId, studentId: input.studentId, occurrenceDate: input.occurrenceDate,
      scheduledStart: input.scheduledStart, note: input.note, scores: input.scores.map((s) => ({ ...s })), recordedBy: input.actorUserId, recordedAt: now, updatedBy: input.actorUserId, updatedAt: now,
    });
    evaluation.publish(EvaluationEventTypes.RECORDED, input.clock, true);
    return evaluation;
  }

  static rehydrate(snapshot: EvaluationSnapshot): Evaluation {
    return new Evaluation(snapshot);
  }

  get snapshot(): EvaluationSnapshot {
    return this.state;
  }

  /**
   * Overwrites the given scores (categories the evaluation already has). Returns the categories whose value actually changed; when none did, nothing changes and nothing is
   * published. Nothing of the previous values is kept anywhere.
   */
  changeScores(input: { scores: ReadonlyArray<{ category: EvaluationCategory; score: number }>; actorUserId: string; clock: Clock }): EvaluationCategory[] {
    const changed: EvaluationCategory[] = [];
    const next = this.state.scores.map((current) => {
      const wanted = input.scores.find((s) => s.category === current.category);
      if (!wanted || sameScore(wanted.score, current.score)) return current;
      changed.push(current.category);
      return { ...current, score: wanted.score };
    });
    if (changed.length === 0) return changed;
    this.state = { ...this.state, scores: next, updatedBy: input.actorUserId, updatedAt: input.clock.now() };
    this.publish(EvaluationEventTypes.SCORES_UPDATED, input.clock, false);
    return changed;
  }

  private publish(eventType: (typeof EvaluationEventTypes)[keyof typeof EvaluationEventTypes], clock: Clock, withNote: boolean): void {
    const s = this.state;
    this.addDomainEvent(
      createDomainEvent<EvaluationEventPayload>(
        {
          eventType,
          aggregateType: EVALUATION_AGGREGATE_TYPE,
          aggregateId: s.id,
          payload: {
            evaluationId: s.id, sessionId: s.sessionId, schoolId: s.schoolId, groupId: s.groupId, studentId: s.studentId, occurrenceDate: s.occurrenceDate,
            scores: s.scores.map((x) => ({ category: x.category, score: x.score })), ...(withNote ? { note: s.note } : {}), actorUserId: s.updatedBy,
          },
        },
        clock,
      ),
    );
  }
}
