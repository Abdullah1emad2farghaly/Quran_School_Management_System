/**
 * Parent domain events (outbox, same transaction as the change). Payloads carry identifiers ONLY: no names, phones or address text.
 *  - ParentRegistered: a Parent record was created for an account (new or an existing, identity-confirmed one).
 *  - ParentUpdated: the Parent's name was corrected.
 *  - ParentAddressChanged: a new current Parent Address was stored (the previous one stays in the history).
 *  - ParentSchoolLinked / ParentSchoolLinkRemoved: the Parent-to-School relationship (one per school, with history).
 */
export const ParentEventTypes = {
  PARENT_REGISTERED: 'ParentRegistered',
  PARENT_UPDATED: 'ParentUpdated',
  PARENT_ADDRESS_CHANGED: 'ParentAddressChanged',
  PARENT_SCHOOL_LINKED: 'ParentSchoolLinked',
  PARENT_SCHOOL_LINK_REMOVED: 'ParentSchoolLinkRemoved',
} as const;
export type ParentEventType = (typeof ParentEventTypes)[keyof typeof ParentEventTypes];

export const PARENT_AGGREGATE_TYPE = 'Parent';
export const PARENT_SCHOOL_LINK_AGGREGATE_TYPE = 'ParentSchoolLink';

export interface ParentEventPayload {
  readonly parentId: string;
  readonly userId: string;
  readonly organizationId: string;
  /** The acting user. */
  readonly actorId: string;
}

export interface ParentSchoolLinkEventPayload {
  readonly linkId: string;
  readonly parentId: string;
  readonly userId: string;
  readonly schoolId: string;
  readonly organizationId: string;
  readonly actorId: string;
}
