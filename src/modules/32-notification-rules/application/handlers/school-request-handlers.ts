import type { DomainEvent } from '../../../00-shared-kernel/public';
import type { EventHandler } from '../../../06-domain-events-outbox/public';
import { SchoolEventTypes, type SchoolEventPayload } from '../../../16-schools/public';
import { dedupKeys } from '../../domain/value-objects/dedup-keys';
import { cleanText } from '../../domain/value-objects/message-format';
import { TEMPLATE_KEYS } from '../services/rule-templates';
import { idOf, notifyUser, payloadOf, type RuleDeps } from '../services/rule-support';

/**
 * School request notifications (approved Module 32 decision 8; §29-31, §63):
 *  - a school creation request is SUBMITTED (a public submission, so the school has an applicant) -> the Organization Manager(s) of the organization.
 *  - the Organization Manager APPROVES or REJECTS it -> the ORIGINAL REQUESTER only (the applicant), with the rejection reason when rejected. The resulting School Manager is the
 *    same person as the applicant, but nobody else is told; a school an organization manager created directly (no applicant) is not a request and notifies nobody.
 * The events carry identifiers only (no name, no reason), so the school is read through Module 16's `SchoolLookup`.
 */
export function createSchoolRequestHandlers(deps: RuleDeps): EventHandler[] {
  return [
    {
      name: 'notification-rules.school-request-submitted',
      eventTypes: [SchoolEventTypes.SCHOOL_CREATED],
      async handle(event: DomainEvent): Promise<void> {
        const schoolId = idOf(payloadOf<SchoolEventPayload>(event).schoolId);
        if (!schoolId) return;
        const school = await deps.schools.find(schoolId);
        if (!school || school.applicantUserId === null) return; // not a request: created directly by an organization manager
        const managers = await deps.schools.organizationManagerUserIds(school.organizationId);
        if (managers.length === 0) return;
        await deps.notifications.notify({
          recipientUserIds: managers,
          templateKey: TEMPLATE_KEYS.schoolRequestSubmitted,
          params: { school: school.name, applicant: cleanText(school.applicantName, 120) },
          data: { schoolId: school.id },
          dedupKey: dedupKeys.schoolRequest(event.eventId),
        });
      },
    },
    {
      name: 'notification-rules.school-request-decided',
      eventTypes: [SchoolEventTypes.SCHOOL_APPROVED, SchoolEventTypes.SCHOOL_REJECTED],
      async handle(event: DomainEvent): Promise<void> {
        const schoolId = idOf(payloadOf<SchoolEventPayload>(event).schoolId);
        if (!schoolId) return;
        const school = await deps.schools.find(schoolId);
        if (!school || school.applicantUserId === null) return; // nobody asked: nobody is told
        const data = { schoolId: school.id };
        const key = dedupKeys.schoolDecision(event.eventId);
        if (event.eventType === SchoolEventTypes.SCHOOL_APPROVED) {
          await notifyUser(deps, school.applicantUserId, TEMPLATE_KEYS.schoolRequestApproved, { school: school.name }, data, key);
        } else {
          await notifyUser(deps, school.applicantUserId, TEMPLATE_KEYS.schoolRequestRejected, { school: school.name, reason: cleanText(school.rejectionReason, 500) }, data, key);
        }
      },
    },
  ];
}

