import type { EventHandler } from '../../../06-domain-events-outbox/public';
import type { GroupService } from './group-service';

/**
 * Module 19 publishes `StudentStatusChanged` (the Students module must not depend on Groups). When a student is ARCHIVED (final), this consumer
 * ends the student's current group period with the reason STUDENT_ARCHIVED. Delivery is at-least-once, and `unassignArchivedStudent` is
 * idempotent (it re-checks that the student really is ARCHIVED and that a current period exists). Throwing means "retry later".
 */
export function createStudentArchivedHandler(getService: () => Pick<GroupService, 'unassignArchivedStudent'>): EventHandler {
  return {
    name: 'groups.unassign-archived-student',
    eventTypes: ['StudentStatusChanged'],
    handle: async (event) => {
      const payload = event.payload as { studentId?: unknown; status?: unknown };
      if (payload.status !== 'ARCHIVED' || typeof payload.studentId !== 'string') return;
      await getService().unassignArchivedStudent(payload.studentId);
    },
  };
}
