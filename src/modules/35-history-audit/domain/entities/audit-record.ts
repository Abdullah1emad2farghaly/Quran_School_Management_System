/** One immutable audit record (Master Specification §64). It is only ever inserted and read; nothing updates or deletes it (retention: indefinite). */
export interface AuditRecord {
  readonly id: string;
  /** The domain event that produced it: unique, so an at-least-once redelivery never creates a second record. */
  readonly eventId: string;
  /** Null for a system-originated event (no authenticated caller). */
  readonly actorUserId: string | null;
  readonly action: string;
  readonly module: string;
  readonly entityType: string;
  readonly entityId: string;
  /** What the event carried about the previous state (`previousX` fields), or null. */
  readonly before: Readonly<Record<string, unknown>> | null;
  /** What the event carried about the new state (identifiers, statuses, reasons), or null. Sensitive keys are never copied. */
  readonly after: Readonly<Record<string, unknown>> | null;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
  readonly requestId: string | null;
  /** Scope of the record, taken from the event (and the school's organization): who may read it. Both null = Main Admin only. */
  readonly organizationId: string | null;
  readonly schoolId: string | null;
  /** When the audited action happened (`timestamp` of §64). */
  readonly occurredAt: Date;
  readonly recordedAt: Date;
}
