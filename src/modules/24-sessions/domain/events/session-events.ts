/**
 * Class session events (outbox, same transaction as the change). Identifiers, times, status and reasons only: never a name.
 *  - ClassSessionCreated: the session was generated (OPEN), 15 minutes before its scheduled start.
 *  - ClassSessionStarted: the system moved it OPEN -> IN_PROGRESS at its scheduled start.
 *  - ClassSessionCompleted: the system moved it IN_PROGRESS -> COMPLETED at its scheduled end.
 *  - ClassSessionCancelled: cancelled by the assigned Teacher (`cancelSource` TEACHER, with `actorId` and `reason`) or by the system because the slot was
 *    retired before the start (`cancelSource` SCHEDULE_SLOT_RETIRED, with `slotRetireReason`, no actor).
 */
export const SessionEventTypes = {
  CREATED: 'ClassSessionCreated',
  STARTED: 'ClassSessionStarted',
  COMPLETED: 'ClassSessionCompleted',
  CANCELLED: 'ClassSessionCancelled',
} as const;
export type SessionEventType = (typeof SessionEventTypes)[keyof typeof SessionEventTypes];

export const CLASS_SESSION_AGGREGATE_TYPE = 'ClassSession';

export interface SessionEventPayload {
  readonly sessionId: string;
  readonly schoolId: string;
  readonly groupId: string;
  readonly teacherId: string;
  readonly slotId: string;
  readonly occurrenceDate: string;
  readonly scheduledStart: string;
  readonly scheduledEnd: string;
  readonly status: string;
  readonly cancelSource?: string | null;
  readonly actorId?: string | null;
  readonly reason?: string | null;
  readonly slotRetireReason?: string | null;
}
