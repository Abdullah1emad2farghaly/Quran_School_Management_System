import type { EventHandler } from '../../../06-domain-events-outbox/public';
import { GroupEventTypes } from '../../../20-groups/public';
import type { ExamService } from '../services/exam-service';

/**
 * Reacts to Module 20's public events (GroupStudentAssigned / GroupStudentUnassigned). Before an exam STARTS its target list is computed live from the current membership, so
 * nothing needs to be synchronized or can drift; the handler only publishes ExamStudentTargeted / ExamStudentUntargeted for the SCHEDULED exams that target the group, so the
 * Notifications modules can tell the parent of a student added after scheduling. After STARTED the target list is frozen and such events change nothing. Idempotent in effect
 * (it changes no state; a repeated delivery only repeats a notification event, which its consumers de-duplicate by exam and student).
 */
export function createExamGroupMembershipHandler(getService: () => Pick<ExamService, 'onGroupMembershipChanged'>): EventHandler {
  return {
    name: 'exams.group-membership',
    eventTypes: [GroupEventTypes.GROUP_STUDENT_ASSIGNED, GroupEventTypes.GROUP_STUDENT_UNASSIGNED],
    async handle(event) {
      const p = event.payload as { groupId?: string; schoolId?: string; studentId?: string; reason?: string };
      if (!p.groupId || !p.schoolId || !p.studentId) return;
      await getService().onGroupMembershipChanged({
        kind: event.eventType === GroupEventTypes.GROUP_STUDENT_ASSIGNED ? 'ASSIGNED' : 'UNASSIGNED', schoolId: p.schoolId, groupId: p.groupId, studentId: p.studentId, ...(p.reason ? { reason: p.reason } : {}),
      });
    },
  };
}
