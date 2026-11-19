import type { AuditRecord } from '../../domain/entities/audit-record';

/** The caller of a read: the verified account and the role its session currently acts as. */
export interface AuditViewer {
  readonly userId: string;
  readonly activeRole: string | null;
}

export interface AuditRecordDto {
  readonly id: string;
  readonly actorUserId: string | null;
  readonly action: string;
  readonly module: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly before: Readonly<Record<string, unknown>> | null;
  readonly after: Readonly<Record<string, unknown>> | null;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
  readonly organizationId: string | null;
  readonly schoolId: string | null;
  /** The `timestamp` of §64: when the audited action happened. */
  readonly timestamp: Date;
}

export const toAuditRecordDto = (r: AuditRecord): AuditRecordDto => ({
  id: r.id,
  actorUserId: r.actorUserId,
  action: r.action,
  module: r.module,
  entityType: r.entityType,
  entityId: r.entityId,
  before: r.before,
  after: r.after,
  ipAddress: r.ipAddress,
  userAgent: r.userAgent,
  organizationId: r.organizationId,
  schoolId: r.schoolId,
  timestamp: r.occurredAt,
});
