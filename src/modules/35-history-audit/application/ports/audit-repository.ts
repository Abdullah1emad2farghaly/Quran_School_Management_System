import type { PageRequest } from '../../../00-shared-kernel/public';
import type { AuditRecord } from '../../domain/entities/audit-record';

/**
 * Who may see a record. `all` = the whole trail (Main Admin). Otherwise a record is visible when its `organizationId` is in `organizationIds` OR its `schoolId` is in
 * `schoolIds`; empty lists see nothing. The repository applies this to EVERY read, so no query can return a record outside the caller's scope.
 */
export type AuditVisibility = { readonly all: true } | { readonly all: false; readonly organizationIds: readonly string[]; readonly schoolIds: readonly string[] };

export interface AuditFilter {
  readonly module?: string;
  readonly action?: readonly string[];
  readonly entityType?: string;
  readonly entityId?: string;
  readonly actorUserId?: string;
  readonly organizationId?: string;
  readonly schoolId?: string;
  /** Inclusive lower bound of `occurredAt`. */
  readonly from?: Date;
  /** Exclusive upper bound of `occurredAt`. */
  readonly to?: Date;
}

/**
 * Persistence of the audit trail (Module 35's own table). It is APPEND-ONLY BY CONSTRUCTION: the port has no update and no delete, and the table rejects both.
 */
export interface AuditRepository {
  /** Inserts the record. Returns false (and writes nothing) when a record for the same `eventId` already exists (at-least-once redelivery). */
  insert(record: AuditRecord): Promise<boolean>;
  list(visibility: AuditVisibility, filter: AuditFilter, options: { newestFirst: boolean; page: PageRequest }): Promise<{ items: AuditRecord[]; total: number }>;
  /** One record if it exists AND is visible to the caller; otherwise null. */
  findVisibleById(visibility: AuditVisibility, id: string): Promise<AuditRecord | null>;
}
