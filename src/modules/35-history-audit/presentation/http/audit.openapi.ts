import { listQueryParameters, ref, schema as s, type AuthorizationDoc, type ErrorDoc, type ModuleApiDoc, type SchemaObject } from '../../../04-validation-api/public';
import { AuditPermissions } from '../../application/services/audit-authorization';
import { AUDIT_ACTIONS } from '../../domain/value-objects/audit-action';
import { AUDIT_LIST_SPEC } from './audit-routes';

const AUDIT_ID = '4e8a2c71-5b36-4d90-8f17-3a9c6d0e2b58';
const USER_ID = '3f6b1d52-8a4e-4c1b-9d77-2b6f0c9a1e10';
const SCHOOL_ID = '9a4e7c21-6d03-4b58-8e1f-0c2d5b7a3f64';
const ORG_ID = '7c1d5e93-2b8a-4f60-a1d4-9e3b6c0f8a21';
const SUBSCRIPTION_ID = '5d1c8e07-3a92-4b64-9f10-7e2a6c4b8d13';

const authorization = (permissionId: string): AuthorizationDoc => ({
  authentication: 'required',
  roles: ['MAIN_ADMIN', 'ORGANIZATION_MANAGER', 'SCHOOL_MANAGER'],
  scope: 'The Main Admin sees every record; an Organization Manager the records of the organizations they administer; a School Manager the records of the schools they manage (by the session\'s active role).',
  enforcement:
    'Enforced by the Authorization Engine (deny by default) for the role, and by the audit query itself for the scope: every read is restricted server-side to the records the caller may see, from the caller\'s own organization/school links. A record without an organization or school (identity, roles) is visible to the Main Admin only. TEACHER, STUDENT, PARENT, SUBSCRIPTION_COLLECTOR and the geographic managers have no audit permission.',
  permissionId,
  decision: 'APPROVED',
  reference: 'Master Specification §64; docs/AUDIT.md',
});

const NOT_ALLOWED: ErrorDoc = { status: 403, codes: ['ACCESS_DENIED', 'PASSWORD_CHANGE_REQUIRED'], description: 'The caller\'s active role has no audit permission (no reason is given), or the account must still change its initial password.' };

const free = (description: string): SchemaObject => ({ type: 'object', nullable: true, additionalProperties: true, description });

const auditRecordSchema = s.object(
  {
    id: s.uuid(),
    actorUserId: s.uuid({ nullable: true, description: 'The authenticated caller who caused the action; null for a system-originated event.' }),
    action: s.string({ enum: AUDIT_ACTIONS, description: 'The kind of change.' }),
    module: s.string({ description: 'The area of the system, for example `subscriptions`, `schools`, `students`.' }),
    entityType: s.string({ description: 'The kind of record that changed (the event\'s aggregate), for example `Subscription`.' }),
    entityId: s.string({ description: 'The id of the record that changed.' }),
    before: free('What the event carried about the PREVIOUS state (for example `status` of a correction), or null. Only what the event carries: no other module was changed to supply more.'),
    after: free('What the event carried about the new state (identifiers, statuses, reasons), or null. Secrets and contact data are never copied.'),
    ipAddress: s.string({ nullable: true, description: 'Client address of the request, as seen by the server (trusted-proxy aware); null for a system-originated event.' }),
    userAgent: s.string({ nullable: true, description: 'The request\'s User-Agent (sanitized, at most 255 characters); null for a system-originated event.' }),
    organizationId: s.uuid({ nullable: true }),
    schoolId: s.uuid({ nullable: true }),
    timestamp: s.dateTime({ description: 'When the audited action happened.' }),
  },
  ['id', 'actorUserId', 'action', 'module', 'entityType', 'entityId', 'before', 'after', 'ipAddress', 'userAgent', 'organizationId', 'schoolId', 'timestamp'],
);

const example = {
  id: AUDIT_ID,
  actorUserId: USER_ID,
  action: 'PAYMENT',
  module: 'subscriptions',
  entityType: 'Subscription',
  entityId: SUBSCRIPTION_ID,
  before: null,
  after: { subscriptionId: SUBSCRIPTION_ID, schoolId: SCHOOL_ID, status: 'PAID' },
  ipAddress: '203.0.113.7',
  userAgent: 'Mozilla/5.0 (X11; Linux x86_64)',
  organizationId: ORG_ID,
  schoolId: SCHOOL_ID,
  timestamp: '2026-11-16T09:30:00.000Z',
};

export const auditApiDoc: ModuleApiDoc = {
  moduleId: '35',
  mountPath: '/audit-logs',
  tag: {
    name: 'History & Audit',
    description:
      'The immutable audit trail (Master Specification §64): who did what, to which record, when, from where. Records are written only by the system from the domain events (nothing writes, changes or deletes them over HTTP) and kept indefinitely. READ-ONLY, scoped to what the caller manages.',
  },
  operations: [
    {
      method: 'get',
      path: '/',
      operationId: 'listAuditLogs',
      summary: 'List audit records',
      description:
        'A paginated list, newest first by default (`sort=timestamp` or `-timestamp`). Filters only narrow what the caller may already see: `filter[module]`, `filter[action]=PAYMENT,WAIVER`, `filter[entityType]`, `filter[entityId]`, `filter[actorUserId]`, `filter[organizationId]`, `filter[schoolId]`, `filter[from]` / `filter[to]` (inclusive calendar days, UTC). A caller with no visible records gets an empty page.',
      authorization: authorization(AuditPermissions.LIST),
      query: listQueryParameters(AUDIT_LIST_SPEC),
      success: { status: 200, description: 'A page of audit records.', paginated: true, data: ref('AuditRecord'), example },
      errors: [NOT_ALLOWED],
    },
    {
      method: 'get',
      path: '/:id',
      operationId: 'getAuditLog',
      summary: 'Read one audit record',
      description: 'A record that does not exist and a record outside the caller\'s scope answer the same `404 AUDIT_RECORD_NOT_FOUND`, so ids cannot be probed.',
      authorization: authorization(AuditPermissions.READ),
      pathParams: { id: { description: 'The audit record id.', example: AUDIT_ID } },
      success: { status: 200, description: 'The audit record.', data: ref('AuditRecord'), example },
      errors: [NOT_ALLOWED, { status: 404, codes: ['AUDIT_RECORD_NOT_FOUND'], description: 'The record does not exist or is not visible to the caller.' }],
    },
  ],
  schemas: { AuditRecord: auditRecordSchema },
};
