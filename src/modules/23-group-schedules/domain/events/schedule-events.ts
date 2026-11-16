/**
 * Group schedule events (outbox, same transaction as the change). Identifiers, weekday, times and reasons ONLY: never a name.
 *  - GroupScheduleSlotCreated: a slot became active (a change is a Retired (REPLACED) followed by a Created in the same transaction).
 *  - GroupScheduleSlotRetired: `reason` REPLACED (`replacedBySlotId` names the new slot), REMOVED, or GROUP_ARCHIVED.
 */
export const ScheduleEventTypes = {
  SLOT_CREATED: 'GroupScheduleSlotCreated',
  SLOT_RETIRED: 'GroupScheduleSlotRetired',
} as const;
export type ScheduleEventType = (typeof ScheduleEventTypes)[keyof typeof ScheduleEventTypes];

export const SCHEDULE_SLOT_AGGREGATE_TYPE = 'GroupScheduleSlot';

export interface ScheduleEventPayload {
  readonly slotId: string;
  readonly groupId: string;
  readonly schoolId: string;
  readonly dayOfWeek: string;
  readonly startTime: string;
  readonly endTime: string;
  readonly actorId: string;
  readonly reason?: string;
  readonly replacedBySlotId?: string | null;
}
