import { SystemClock } from '../modules/00-shared-kernel/public';
import {
  AuditQueryService,
  AuditRecorder,
  SequelizeAuditRepository,
  createRecordAuditOnDomainEventHandler,
  registerAuditAuthorization,
  type AuditScopeDirectory,
} from '../modules/35-history-audit/public';
import { getAuthorizationPolicyRegistry } from './authorization';
import { getSequelize } from './database';
import { getOrganizationService } from './organization';
import { getEventHandlerRegistry } from './outbox';
import { getSchoolService } from './schools';

let repository: SequelizeAuditRepository | undefined;
const getRepository = () => (repository ??= new SequelizeAuditRepository(getSequelize()));

/** What Module 35 needs about places, answered through the PUBLIC services of Modules 13 and 16 (Module 35 reads no other module's tables). */
const scopes: AuditScopeDirectory = {
  organizationIdsOf: (userId) => getOrganizationService().listAdministeredOrganizationIds(userId),
  schoolIdsOf: (userId) => getSchoolService().listManagedSchoolIds(userId),
  organizationOfSchool: async (schoolId) => (await getSchoolService().findById(schoolId))?.organizationId ?? null,
};

let recorder: AuditRecorder | undefined;
export function getAuditRecorder(): AuditRecorder {
  return (recorder ??= new AuditRecorder({ repository: getRepository(), scopes, clock: new SystemClock() }));
}

let query: AuditQueryService | undefined;
/** Read-only access to the audit trail, restricted to what the caller manages. */
export function getAuditQueryService(): AuditQueryService {
  return (query ??= new AuditQueryService({ repository: getRepository(), scopes }));
}

let handlersRegistered = false;
/** Call once at startup, before startOutbox(): every audited domain event (the catalog in Module 35) is recorded from the outbox. */
export function registerAuditEventHandlers(): void {
  if (handlersRegistered) return;
  handlersRegistered = true;
  getEventHandlerRegistry().register(createRecordAuditOnDomainEventHandler(getAuditRecorder()));
}

/** Audit permissions are registered ONCE, when this module is loaded, through the shared Authorization Engine. */
registerAuditAuthorization({ policies: getAuthorizationPolicyRegistry() });
