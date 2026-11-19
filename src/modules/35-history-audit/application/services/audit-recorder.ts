import type { Clock, DomainEvent } from '../../../00-shared-kernel/public';
import { buildAuditRecord } from '../../domain/services/audit-record-builder';
import type { AuditRepository } from '../ports/audit-repository';
import type { AuditScopeDirectory } from '../ports/audit-scope-directory';

export interface AuditRecorderDeps {
  readonly repository: AuditRepository;
  readonly scopes: Pick<AuditScopeDirectory, 'organizationOfSchool'>;
  readonly clock: Clock;
}

/**
 * Writes the audit record of a domain event (called by the outbox handler; delivery is at-least-once, so it is idempotent on the event id).
 * Events outside the catalog are ignored. A school-scoped event whose payload names no organization gets the school's organization, so an Organization Manager's
 * scope can find it; if that lookup fails the error propagates and the outbox retries (a record is never written with a silently wrong scope).
 */
export class AuditRecorder {
  constructor(private readonly deps: AuditRecorderDeps) {}

  /** Returns true when a new record was written. */
  async record(event: DomainEvent): Promise<boolean> {
    const built = buildAuditRecord(event, this.deps.clock.now());
    if (!built) return false;
    const record =
      built.organizationId === null && built.schoolId !== null
        ? { ...built, organizationId: await this.deps.scopes.organizationOfSchool(built.schoolId) }
        : built;
    return this.deps.repository.insert(record);
  }
}
