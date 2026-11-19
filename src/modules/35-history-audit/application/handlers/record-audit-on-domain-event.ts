import type { DomainEvent } from '../../../00-shared-kernel/public';
import type { EventHandler } from '../../../06-domain-events-outbox/public';
import { AUDITED_EVENT_TYPES } from '../../domain/value-objects/audit-catalog';
import type { AuditRecorder } from '../services/audit-recorder';

/** Subscribes the audit recorder to every audited event (the catalog is the only list). Failures propagate so the outbox retries; a redelivery never duplicates a record. */
export function createRecordAuditOnDomainEventHandler(recorder: Pick<AuditRecorder, 'record'>): EventHandler {
  return {
    name: 'audit.record-domain-event',
    eventTypes: [...AUDITED_EVENT_TYPES],
    async handle(event: DomainEvent): Promise<void> {
      await recorder.record(event);
    },
  };
}
