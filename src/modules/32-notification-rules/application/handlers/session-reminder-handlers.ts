import type { DomainEvent } from '../../../00-shared-kernel/public';
import type { EventHandler } from '../../../06-domain-events-outbox/public';
import { SessionEventTypes, type SessionEventPayload } from '../../../24-sessions/public';
import { parseInstant } from '../../domain/value-objects/message-format';
import { REMINDER_KINDS, evaluationWarningDueAt, halfSessionDueAt } from '../../domain/value-objects/reminder-rules';
import { idOf, payloadOf, type RuleDeps } from '../services/rule-support';

/**
 * Schedules and cancels the two time-driven session reminders (approved Module 32 decisions 5, 6 and 9; §63; Module 29):
 *  - ClassSessionCreated: a reminder row is created for the HALF-SESSION reminder (half of the scheduled duration after the start) and for the EVALUATION warning (15 minutes before the
 *    scheduled end). Whether a reminder is actually due is decided when it fires, from the public reads of Modules 27, 28 and 29, never from this schedule.
 *  - ClassSessionCancelled / ClassSessionCompleted: the pending reminders of the session are suppressed, so nothing is sent for a cancelled or finished session.
 */
export function createSessionReminderHandlers(deps: RuleDeps): EventHandler[] {
  return [
    {
      name: 'notification-rules.session-reminders-schedule',
      eventTypes: [SessionEventTypes.CREATED],
      async handle(event: DomainEvent): Promise<void> {
        const p = payloadOf<SessionEventPayload>(event);
        const sessionId = idOf(p.sessionId);
        const start = parseInstant(p.scheduledStart);
        const end = parseInstant(p.scheduledEnd);
        if (!sessionId || !start || !end || end.getTime() <= start.getTime()) return;
        const now = deps.clock.now();
        // No historical reminder: a session that is already over when its event is handled gets none (there is no backfill of sessions generated before Module 32).
        if (end.getTime() <= now.getTime()) return;
        await deps.state.upsertReminder(REMINDER_KINDS.SESSION_HALF_TIME, sessionId, halfSessionDueAt(start, end), now);
        await deps.state.upsertReminder(REMINDER_KINDS.SESSION_EVALUATION, sessionId, evaluationWarningDueAt(end), now);
      },
    },
    {
      name: 'notification-rules.session-reminders-suppress',
      eventTypes: [SessionEventTypes.CANCELLED, SessionEventTypes.COMPLETED],
      async handle(event: DomainEvent): Promise<void> {
        const sessionId = idOf(payloadOf<SessionEventPayload>(event).sessionId);
        if (!sessionId) return;
        await deps.state.suppressPending(sessionId, [REMINDER_KINDS.SESSION_HALF_TIME, REMINDER_KINDS.SESSION_EVALUATION], deps.clock.now());
      },
    },
  ];
}
