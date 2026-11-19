// Public contract of Module 35 (History & Audit): the immutable audit trail written from domain events and read (scoped) over HTTP.
// Other modules import ONLY from here. Modules do not call it: they publish domain events through the outbox, and the audit handler records the ones in the catalog.
export { AuditRecorder, type AuditRecorderDeps } from '../application/services/audit-recorder';
export { AuditQueryService, type AuditQueryServiceDeps } from '../application/services/audit-query-service';
export { AuditPermissions, registerAuditAuthorization, type AuditAuthorizationDeps } from '../application/services/audit-authorization';
export { AUDIT_ERROR_MESSAGES } from '../application/services/audit-error-messages';
export { createRecordAuditOnDomainEventHandler } from '../application/handlers/record-audit-on-domain-event';
export type { AuditRepository, AuditFilter, AuditVisibility } from '../application/ports/audit-repository';
export type { AuditScopeDirectory } from '../application/ports/audit-scope-directory';
export { toAuditRecordDto, type AuditRecordDto, type AuditViewer } from '../application/dto/audit-dto';
export type { AuditRecord } from '../domain/entities/audit-record';
export { AUDIT_ACTIONS, type AuditAction } from '../domain/value-objects/audit-action';
export { AUDITED_EVENTS, AUDITED_EVENT_TYPES, type AuditedEvent } from '../domain/value-objects/audit-catalog';
export { buildAuditRecord } from '../domain/services/audit-record-builder';
export { AuditErrorCodes, auditError, type AuditErrorCode } from '../domain/errors/audit-errors';
export { InMemoryAuditRepository } from '../infrastructure/services/in-memory-audit-repository';
export { SequelizeAuditRepository } from '../infrastructure/persistence/sequelize/repositories/sequelize-audit-repository';
export { createAuditRouter, AUDIT_LIST_SPEC, auditFilterOf, serializeAuditRecord, type AuditRouterDeps, type AuditHandlerService } from '../presentation/http/audit-routes';
export { auditApiDoc } from '../presentation/http/audit.openapi';
