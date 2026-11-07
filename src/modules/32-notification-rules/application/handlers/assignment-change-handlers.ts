import type { DomainEvent } from '../../../00-shared-kernel/public';
import type { EventHandler } from '../../../06-domain-events-outbox/public';
import { MemorizationEventTypes, type MemorizationAssignmentEventPayload } from '../../../27-memorization/public';
import { RevisionEventTypes, type RevisionAssignmentEventPayload } from '../../../28-revision/public';
import { dedupKeys } from '../../domain/value-objects/dedup-keys';
import { describeRange } from '../services/assignment-description';
import { assignmentDetailTemplateKey, assignmentTemplateKey, type AssignmentAction, type AssignmentKind } from '../services/rule-templates';
import { idOf, notifyParentsOf, payloadOf, type RuleDeps } from '../services/rule-support';

interface Mapping {
  readonly kind: AssignmentKind;
  readonly action: AssignmentAction;
}

const MAPPINGS: Readonly<Record<string, Mapping>> = {
  [MemorizationEventTypes.ASSIGNMENT_DEFINED]: { kind: 'memorization', action: 'defined' },
  [MemorizationEventTypes.ASSIGNMENT_MODIFIED]: { kind: 'memorization', action: 'modified' },
  [MemorizationEventTypes.ASSIGNMENT_CANCELLED]: { kind: 'memorization', action: 'cancelled' },
  [RevisionEventTypes.ASSIGNMENT_DEFINED]: { kind: 'revision', action: 'defined' },
  [RevisionEventTypes.ASSIGNMENT_MODIFIED]: { kind: 'revision', action: 'modified' },
  [RevisionEventTypes.ASSIGNMENT_CANCELLED]: { kind: 'revision', action: 'cancelled' },
};

/**
 * Student assignment change notifications (approved Module 32 decision 2; §63). Changing the memorization or revision assignment is the responsible Group Teacher's job
 * (Modules 27 and 28, unchanged). The notification goes to the Parent accounts linked to the AFFECTED student only. The Teacher who made the change is NOT notified (no Teacher
 * is notified by this rule at all). Defining a NEW assignment and MODIFYING an existing one both notify (so does cancelling one). The notification carries the ACTUAL range, by the
 * unit the assignment was defined in (surah and ayah range, Mushaf pages, quarters, surahs with both endpoints, lines): the events carry identifiers only, so the assignment is read
 * through Modules 27 / 28 (`findAssignmentById`, current state) and the page / quarter / names come from Module 21's read-only lookup. When the assignment can no longer be found the
 * plain notification (student and group) is sent rather than none. An INDIVIDUAL assignment affects its student; the shared assignment of a GROUP-mode group (studentId null) affects every student currently
 * in the group, and each parent is told only about their own linked children (one notification per child).
 */
export function createAssignmentChangeHandler(deps: RuleDeps): EventHandler {
  return {
    name: 'notification-rules.assignment-changed',
    eventTypes: Object.keys(MAPPINGS),
    async handle(event: DomainEvent): Promise<void> {
      const mapping = MAPPINGS[event.eventType];
      if (!mapping) return;
      const p = payloadOf<MemorizationAssignmentEventPayload | RevisionAssignmentEventPayload>(event);
      const groupId = idOf(p.groupId);
      if (!groupId) return;
      const group = await deps.groups.find(groupId);
      if (!group) return;
      const studentId = idOf(p.studentId);
      const studentIds = studentId ? [studentId] : await deps.groups.listStudentIds(groupId);
      const assignmentId = idOf(p.assignmentId);
      const range = assignmentId ? await deps.assignments.find(mapping.kind, assignmentId) : undefined;
      const description = range ? await describeRange(range, deps.quran) : undefined;
      const templateKey = description ? assignmentDetailTemplateKey(mapping.kind, mapping.action, description.shape) : assignmentTemplateKey(mapping.kind, mapping.action);
      for (const id of studentIds) {
        const student = await deps.students.find(id);
        if (!student) continue;
        await notifyParentsOf(deps, student, templateKey, { student: student.fullName, group: group.name, ...(description?.params ?? {}) }, { groupId, studentId: id, assignmentId: assignmentId ?? null }, dedupKeys.assignmentChange(event.eventId, id));
      }
    },
  };
}
