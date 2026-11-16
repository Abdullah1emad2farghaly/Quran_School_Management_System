import type { DomainEvent } from '../../../00-shared-kernel/public';
import { businessDateOf } from '../../../00-shared-kernel/public';
import type { EventHandler } from '../../../06-domain-events-outbox/public';
import { SubscriptionEventTypes, type SubscriptionBatchEventPayload, type SubscriptionEventPayload } from '../../../33-subscriptions/public';
import { dedupKeys } from '../../domain/value-objects/dedup-keys';
import { REMINDER_KINDS, firstUnpaidReminderDueAt, monthEndReminderDueAt } from '../../domain/value-objects/reminder-rules';
import { TEMPLATE_KEYS } from '../services/rule-templates';
import { idOf, notifyParentsOf, payloadOf, type RuleDeps } from '../services/rule-support';

/**
 * Subscription notifications (approved Module 33 decisions; Master Specification §58-§63). The events carry identifiers only, so everything shown is read through the public contracts.
 *  - SubscriptionsCreated (the monthly BULK creation succeeded): the school's CURRENT Subscription Collector(s) are told. The same event SCHEDULES the two time-driven reminders:
 *    one `SUBSCRIPTION_UNPAID_3D` row per created subscription (3 calendar days after its creation date, Africa/Cairo) and one `SUBSCRIPTION_UNPAID_MONTH_END` row for the batch
 *    (the start of the final five calendar days of the month). Whether a reminder is actually sent is decided when it fires, from the CURRENT status (see the reminder processor).
 *  - SubscriptionCreated (one individual subscription after the bulk run): schedules its own 3-day reminder.
 *  - SubscriptionPaid: the student's Parent ONLY is told that the payment was recorded, and the pending 3-day reminder is cancelled.
 *  - SubscriptionWaived: the pending 3-day reminder is cancelled (a waived month is never reminded).
 * Every notification uses a once-only key, so a redelivered event creates nothing twice; scheduling is an upsert on (kind, subject), so it is also safe to repeat.
 */
export function createSubscriptionRuleHandlers(deps: RuleDeps): EventHandler[] {
  return [
    {
      name: 'notification-rules.subscriptions-created',
      eventTypes: [SubscriptionEventTypes.SUBSCRIPTIONS_CREATED],
      async handle(event: DomainEvent): Promise<void> {
        const p = payloadOf<SubscriptionBatchEventPayload>(event);
        const batchId = idOf(p.batchId);
        if (!batchId) return;
        const batch = await deps.subscriptions.findBatch(batchId);
        if (!batch) return;
        const now = deps.clock.now();

        // Schedule first: the reminders must exist even if the notification below has to be retried.
        for (const subscription of await deps.subscriptions.listOfBatch(batchId)) {
          await deps.state.upsertReminder(REMINDER_KINDS.SUBSCRIPTION_UNPAID_3D, subscription.id, firstUnpaidReminderDueAt(businessDateOf(subscription.createdAt)), now);
        }
        await deps.state.upsertReminder(REMINDER_KINDS.SUBSCRIPTION_UNPAID_MONTH_END, batch.id, monthEndReminderDueAt(batch.month), now);

        const collectors = await deps.subscriptions.collectorUserIds(batch.schoolId);
        if (collectors.length === 0) return;
        const school = await deps.schools.find(batch.schoolId);
        const count = typeof p.count === 'number' ? p.count : (await deps.subscriptions.listOfBatch(batchId)).length;
        await deps.notifications.notify({
          recipientUserIds: collectors,
          templateKey: TEMPLATE_KEYS.subscriptionsCreatedCollector,
          params: { school: school?.name ?? '—', month: batch.month, count },
          data: { schoolId: batch.schoolId, month: batch.month, batchId: batch.id },
          dedupKey: dedupKeys.subscriptionsCreated(event.eventId),
        });
      },
    },
    {
      name: 'notification-rules.subscription-created-schedule',
      eventTypes: [SubscriptionEventTypes.SUBSCRIPTION_CREATED],
      async handle(event: DomainEvent): Promise<void> {
        const subscriptionId = idOf(payloadOf<SubscriptionEventPayload>(event).subscriptionId);
        if (!subscriptionId) return;
        const subscription = await deps.subscriptions.find(subscriptionId);
        if (!subscription || subscription.status !== 'UNPAID') return;
        await deps.state.upsertReminder(REMINDER_KINDS.SUBSCRIPTION_UNPAID_3D, subscription.id, firstUnpaidReminderDueAt(businessDateOf(subscription.createdAt)), deps.clock.now());
      },
    },
    {
      name: 'notification-rules.subscription-paid',
      eventTypes: [SubscriptionEventTypes.SUBSCRIPTION_PAID],
      async handle(event: DomainEvent): Promise<void> {
        const p = payloadOf<SubscriptionEventPayload>(event);
        const subscriptionId = idOf(p.subscriptionId);
        const studentId = idOf(p.studentId);
        if (!subscriptionId || !studentId) return;
        await deps.state.suppressPending(subscriptionId, [REMINDER_KINDS.SUBSCRIPTION_UNPAID_3D], deps.clock.now());
        const student = await deps.students.find(studentId);
        if (!student) return;
        const month = idOf(p.month) ?? '—';
        await notifyParentsOf(deps, student, TEMPLATE_KEYS.subscriptionPaidParent, { student: student.fullName, month }, { subscriptionId, studentId, month }, dedupKeys.subscriptionPaid(subscriptionId));
      },
    },
    {
      name: 'notification-rules.subscription-waived',
      eventTypes: [SubscriptionEventTypes.SUBSCRIPTION_WAIVED],
      async handle(event: DomainEvent): Promise<void> {
        const subscriptionId = idOf(payloadOf<SubscriptionEventPayload>(event).subscriptionId);
        if (!subscriptionId) return;
        await deps.state.suppressPending(subscriptionId, [REMINDER_KINDS.SUBSCRIPTION_UNPAID_3D], deps.clock.now());
      },
    },
  ];
}
