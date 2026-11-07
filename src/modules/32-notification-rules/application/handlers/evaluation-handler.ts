import type { DomainEvent } from '../../../00-shared-kernel/public';
import type { EventHandler } from '../../../06-domain-events-outbox/public';
import { EvaluationEventTypes, type EvaluationEventPayload } from '../../../29-evaluations/public';
import { dedupKeys } from '../../domain/value-objects/dedup-keys';
import { cleanText, formatScore, sumScores } from '../../domain/value-objects/message-format';
import type { AssignmentTexts } from '../ports/directories';
import { EVALUATION_CATEGORIES_ORDER, ensureEvaluationTemplate, evaluationParamName, type EvaluationCategoryName } from '../services/rule-templates';
import { idOf, notifyParentsOf, payloadOf, type RuleDeps } from '../services/rule-support';

const isCategory = (value: unknown): value is EvaluationCategoryName => (EVALUATION_CATEGORIES_ORDER as readonly unknown[]).includes(value);
const NOTE_MAX = 1000;

/**
 * Evaluation notifications to the Parent (approved Module 32 decision 7; Module 29 rules unchanged). When an evaluation is first recorded, and again on every score update, every Parent
 * account linked to the evaluated student (and nobody else) is told:
 *  - the student's individual scores, with the assignment each memorization / revision score belongs to (the assignment scheduled for that session and student, when it can be resolved);
 *  - the total score;
 *  - the Teacher's note when one exists (only the first notification can carry it: the note is immutable and the update event never carries it). Without a note the line is omitted.
 * An update carries the CURRENT scores only: the events never contain a superseded value and none is looked up.
 */
export function createEvaluationHandler(deps: RuleDeps): EventHandler {
  return {
    name: 'notification-rules.evaluation-recorded',
    eventTypes: [EvaluationEventTypes.RECORDED, EvaluationEventTypes.SCORES_UPDATED],
    async handle(event: DomainEvent): Promise<void> {
      const p = payloadOf<EvaluationEventPayload>(event);
      const studentId = idOf(p.studentId);
      const sessionId = idOf(p.sessionId);
      if (!studentId || !sessionId || !Array.isArray(p.scores)) return;
      const byCategory = new Map<EvaluationCategoryName, number>();
      for (const s of p.scores) if (s && isCategory(s.category) && typeof s.score === 'number') byCategory.set(s.category, s.score);
      const categories = EVALUATION_CATEGORIES_ORDER.filter((c) => byCategory.has(c));
      if (categories.length === 0) return;
      const student = await deps.students.find(studentId);
      if (!student) return;

      const recorded = event.eventType === EvaluationEventTypes.RECORDED;
      const noteText = recorded && typeof p.note === 'string' && p.note.trim() !== '' ? cleanText(p.note, NOTE_MAX) : undefined;
      let assignments: AssignmentTexts = {};
      try {
        assignments = await deps.sessions.assignmentTexts(sessionId, studentId);
      } catch {
        assignments = {}; // the assignment line is a convenience: it is left out (never invented) when it cannot be read
      }

      const params: Record<string, string> = { student: student.fullName, total: formatScore(sumScores(categories.map((c) => byCategory.get(c) ?? 0))) };
      for (const c of categories) {
        const score = formatScore(byCategory.get(c) ?? 0);
        const assignment = c === 'MEMORIZATION' ? assignments.memorization : c === 'REVISION' ? assignments.revision : undefined;
        params[evaluationParamName(c)] = assignment ? `${score} (${assignment})` : score;
      }
      if (noteText !== undefined) params.note = noteText;

      const templateKey = ensureEvaluationTemplate(deps.templates, { action: recorded ? 'recorded' : 'updated', categories, hasNote: noteText !== undefined });
      await notifyParentsOf(deps, student, templateKey, params, { evaluationId: idOf(p.evaluationId) ?? null, sessionId, studentId }, dedupKeys.evaluation(event.eventId));
    },
  };
}
