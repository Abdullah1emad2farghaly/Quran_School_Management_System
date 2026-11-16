import type { EventHandler } from '../../../06-domain-events-outbox/public';
import type { ScheduleEventPayload } from '../../../23-group-schedules/public';
import type { ClassSessionService } from '../services/class-session-service';

/**
 * Module 23 retired a schedule slot (`GroupScheduleSlotRetired`: replaced, removed, or the group was archived): the OPEN sessions of that slot that have not
 * started are cancelled by the system. Idempotent (delivery is at least once). The same rule runs again as a safety net in the background job.
 */
export function createCancelSessionsOnSlotRetiredHandler(getService: () => Pick<ClassSessionService, 'cancelSessionsOfRetiredSlot'>): EventHandler {
  return {
    name: 'class-sessions.cancel-on-slot-retired',
    eventTypes: ['GroupScheduleSlotRetired'],
    async handle(event) {
      const payload = event.payload as Partial<ScheduleEventPayload> | null;
      if (!payload?.slotId || !payload.reason) return;
      await getService().cancelSessionsOfRetiredSlot(payload.slotId, payload.reason, event.occurredAt);
    },
  };
}
