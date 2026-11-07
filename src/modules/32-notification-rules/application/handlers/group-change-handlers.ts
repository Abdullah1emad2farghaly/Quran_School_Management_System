import type { DomainEvent } from '../../../00-shared-kernel/public';
import type { EventHandler } from '../../../06-domain-events-outbox/public';
import { GroupEventTypes, type GroupEventPayload } from '../../../20-groups/public';
import { dedupKeys } from '../../domain/value-objects/dedup-keys';
import { TEMPLATE_KEYS } from '../services/rule-templates';
import { idOf, notifyParentsOf, notifyTeacher, payloadOf, type RuleDeps } from '../services/rule-support';

/**
 * Group change notifications (approved Module 32 decision 1; §63):
 *  - GroupStudentAssigned / GroupStudentUnassigned: the Parent accounts linked to THAT student only (never a parent of another student), and the Teacher currently responsible for
 *    the group. A move is an unassignment followed by an assignment, so the parents hear about the removal from the previous group and the assignment to the new one, and each
 *    group's Teacher hears about the student leaving / joining.
 *  - GroupTeacherChanged: BOTH the Teacher now responsible and the previously responsible Teacher (no parent is told: no particular student is affected).
 *  - GroupArchived: the responsible Teacher (the parents are told student by student: archiving a group unassigns every student, each with its own GroupStudentUnassigned event).
 */
export function createGroupChangeHandlers(deps: RuleDeps): EventHandler[] {
  return [
    {
      name: 'notification-rules.group-student-changed',
      eventTypes: [GroupEventTypes.GROUP_STUDENT_ASSIGNED, GroupEventTypes.GROUP_STUDENT_UNASSIGNED],
      async handle(event: DomainEvent): Promise<void> {
        const p = payloadOf<GroupEventPayload>(event);
        const groupId = idOf(p.groupId);
        const studentId = idOf(p.studentId);
        if (!groupId || !studentId) return;
        const [group, student] = await Promise.all([deps.groups.find(groupId), deps.students.find(studentId)]);
        if (!group || !student) return;
        const assigned = event.eventType === GroupEventTypes.GROUP_STUDENT_ASSIGNED;
        const archivedGroup = !assigned && p.reason === 'GROUP_ARCHIVED';
        const params = { student: student.fullName, group: group.name };
        const data = { groupId: group.id, studentId: student.id };
        const parentKey = assigned
          ? TEMPLATE_KEYS.groupStudentAssignedParent
          : archivedGroup
            ? TEMPLATE_KEYS.groupStudentUnassignedArchivedParent
            : TEMPLATE_KEYS.groupStudentUnassignedParent;
        await notifyParentsOf(deps, student, parentKey, params, data, dedupKeys.groupChange(event.eventId, 'parent'));
        await notifyTeacher(deps, group.teacherId, assigned ? TEMPLATE_KEYS.groupStudentAssignedTeacher : TEMPLATE_KEYS.groupStudentUnassignedTeacher, params, data, dedupKeys.groupChange(event.eventId, 'teacher'));
      },
    },
    {
      name: 'notification-rules.group-teacher-changed',
      eventTypes: [GroupEventTypes.GROUP_TEACHER_CHANGED],
      async handle(event: DomainEvent): Promise<void> {
        const p = payloadOf<GroupEventPayload>(event);
        const groupId = idOf(p.groupId);
        if (!groupId) return;
        const group = await deps.groups.find(groupId);
        if (!group) return;
        const newTeacherId = idOf(p.teacherId);
        const previousTeacherId = idOf(p.previousTeacherId);
        const params = { group: group.name };
        const data = { groupId: group.id };
        // BOTH Teachers are told (approved decision): the Teacher now responsible, and the Teacher who was responsible before. Either may be absent (a first assignment, or the Teacher was removed).
        await notifyTeacher(deps, newTeacherId, TEMPLATE_KEYS.groupTeacherAssigned, params, data, dedupKeys.groupChange(event.eventId, 'teacher'));
        if (previousTeacherId && previousTeacherId !== newTeacherId) {
          await notifyTeacher(deps, previousTeacherId, TEMPLATE_KEYS.groupTeacherRemoved, params, data, dedupKeys.groupChange(event.eventId, 'previous-teacher'));
        }
      },
    },
    {
      name: 'notification-rules.group-archived',
      eventTypes: [GroupEventTypes.GROUP_ARCHIVED],
      async handle(event: DomainEvent): Promise<void> {
        const groupId = idOf(payloadOf<GroupEventPayload>(event).groupId);
        if (!groupId) return;
        const group = await deps.groups.find(groupId);
        if (!group) return;
        await notifyTeacher(deps, group.teacherId, TEMPLATE_KEYS.groupArchivedTeacher, { group: group.name }, { groupId: group.id }, dedupKeys.groupChange(event.eventId, 'teacher'));
      },
    },
  ];
}
