import { listQueryParameters, ref, schema as s, type AuthorizationDoc, type ErrorDoc, type ModuleApiDoc, type OperationDoc } from '../../../04-validation-api/public';
import { SCHOOL_MANAGER_SOURCES } from '../../domain/entities/school-manager-assignment';
import { SCHOOL_STATUSES } from '../../domain/value-objects/school-status';
import { SchoolPermissions } from '../../application/services/school-authorization';
import { SCHOOL_LIST_SPEC } from './school-routes';

const SCHOOL_ID = '9a4e7c21-6d03-4b58-8e1f-0c2d5b7a3f64';
const ORG_ID = '7c1d5e93-2b8a-4f60-a1d4-9e3b6c0f8a21';
const COUNTRY_ID = 'b2f0a8d1-5c34-4e7a-8d19-6a3c7e1f0b52';
const GOVERNORATE_ID = '1e9d4c7b-0a62-4b8f-9c35-d7f1a2b6e840';
const USER_ID = '3f6b1d52-8a4e-4c1b-9d77-2b6f0c9a1e10';
const MANAGER_ID = 'e0c8a5d2-1f47-4b93-a6d8-5b2e7f1c9a30';

const REFERENCE = 'docs/AUTHORIZATION-MATRIX.md (Schools 16); docs/SCHOOLS.md';
const ENFORCEMENT =
  "Enforced by the Authorization Engine (deny by default): the caller must hold the ORGANIZATION_MANAGER role AND have an active manager link to the school's organization (the scope target is loaded server-side). MAIN_ADMIN has no school permission.";

/** An operation of the ORGANIZATION_MANAGER guarded by a registered permission. */
const orgManager = (permissionId: string, scope: string): AuthorizationDoc => ({
  authentication: 'required',
  roles: ['ORGANIZATION_MANAGER'],
  scope,
  enforcement: ENFORCEMENT,
  permissionId,
  decision: 'APPROVED',
  reference: REFERENCE,
});

const NOT_ALLOWED: ErrorDoc = { status: 403, codes: ['ACCESS_DENIED'], description: 'The caller lacks the permission or the scope over this school (no reason is given).' };
const concurrent: ErrorDoc = { status: 409, codes: ['SCHOOL_CONCURRENT_MODIFICATION'], description: 'A concurrent update could not be resolved; retry.' };
const notFound: ErrorDoc = { status: 404, codes: ['SCHOOL_NOT_FOUND'], description: 'The school does not exist.' };
const gpsErrors: ErrorDoc = {
  status: 400,
  codes: ['INVALID_GPS_COORDINATES', 'GPS_ACCURACY_EXCEEDS_LIMIT'],
  description: 'Latitude/longitude out of range, or the GPS accuracy is worse than 20 meters.',
};
const addressErrors: ErrorDoc[] = [
  {
    status: 400,
    codes: ['INVALID_SCHOOL_NAME', 'INVALID_GPS_COORDINATES', 'GPS_ACCURACY_EXCEEDS_LIMIT', 'SCHOOL_COUNTRY_MISMATCH', 'PARENT_ADDRESS_COUNTRY_MISMATCH', 'INVALID_GEOGRAPHY_HIERARCHY', 'GEOGRAPHY_NODE_INACTIVE'],
    description: "A business validation failed (name, GPS, country or address).",
  },
  { status: 404, codes: ['GEOGRAPHY_NODE_NOT_FOUND'], description: 'The governorate does not exist.' },
];

const gpsSchema = s.object(
  {
    latitude: s.number({ description: 'Degrees, -90 to 90 (range enforced by the service: `INVALID_GPS_COORDINATES`).', example: 30.0444 }),
    longitude: s.number({ description: 'Degrees, -180 to 180 (range enforced by the service).', example: 31.2357 }),
    accuracyMeters: s.number({ description: 'Reported GPS accuracy; must be 20 meters or better (`GPS_ACCURACY_EXCEEDS_LIMIT` otherwise).', example: 8 }),
  },
  ['latitude', 'longitude', 'accuracyMeters'],
);
const gpsExample = { latitude: 30.0444, longitude: 31.2357, accuracyMeters: 8 };

const schoolExample = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: SCHOOL_ID,
  code: 'SC-000001',
  name: 'Al-Huda Quran School',
  status: 'ACTIVE',
  organizationId: ORG_ID,
  countryId: COUNTRY_ID,
  governorateId: GOVERNORATE_ID,
  centerName: null,
  villageName: null,
  gps: gpsExample,
  createdBy: USER_ID,
  applicantUserId: null,
  applicantName: null,
  decidedBy: null,
  decidedAt: null,
  rejectionReason: null,
  createdAt: '2026-10-15T09:30:00.000Z',
  updatedAt: '2026-10-15T09:30:00.000Z',
  ...overrides,
});

const managerExample = {
  id: MANAGER_ID,
  schoolId: SCHOOL_ID,
  userId: USER_ID,
  source: 'APPROVAL',
  assignedAt: '2026-10-15T10:00:00.000Z',
  assignedBy: USER_ID,
  revokedAt: null,
  revokedBy: null,
  isActive: true,
};

const schoolIdParam = { id: { description: 'The school id.', example: SCHOOL_ID, schema: s.uuid() } };

const schoolForm = (extra: Readonly<Record<string, ReturnType<typeof s.string>>>) =>
  s.object(
    {
      name: s.string({ maxLength: 200, example: 'Al-Huda Quran School' }),
      governorateId: s.uuid({ example: GOVERNORATE_ID }),
      countryId: s.uuid({ nullable: true, description: "Optional; when sent it must equal the organization's country (`SCHOOL_COUNTRY_MISMATCH`)." }),
      centerName: s.string({ nullable: true, maxLength: 200, description: 'Optional free text (center or city).' }),
      villageName: s.string({ nullable: true, maxLength: 200, description: 'Optional free text.' }),
      gps: ref('Gps'),
      ...extra,
    },
    ['name', 'governorateId', 'gps'],
  );

const statusChange = (
  action: 'deactivate' | 'reactivate',
  permissionId: string,
  summary: string,
  description: string,
  resultStatus: string,
): OperationDoc => ({
  method: 'post',
  path: `/:id/${action}`,
  operationId: `${action}School`,
  summary,
  description,
  authorization: orgManager(permissionId, "The school's organization."),
  pathParams: schoolIdParam,
  success: { status: 200, description: `The school, now ${resultStatus}.`, data: ref('School'), example: schoolExample({ status: resultStatus }) },
  errors: [
    NOT_ALLOWED,
    notFound,
    concurrent,
    { status: 422, codes: ['SCHOOL_INVALID_STATUS_TRANSITION', 'SCHOOL_ORGANIZATION_INACTIVE'], description: 'The school is not in a status this change applies to, or its organization is inactive.' },
  ],
});

const managerSchema = s.object(
  {
    id: s.uuid(),
    schoolId: s.uuid(),
    userId: s.uuid(),
    source: s.string({ enum: SCHOOL_MANAGER_SOURCES }),
    assignedAt: s.dateTime(),
    assignedBy: s.uuid(),
    revokedAt: s.dateTime({ nullable: true }),
    revokedBy: s.uuid({ nullable: true }),
    isActive: s.boolean(),
  },
  ['id', 'schoolId', 'userId', 'source', 'assignedAt', 'assignedBy', 'revokedAt', 'revokedBy', 'isActive'],
);

/** OpenAPI contract of `/schools` (`school-routes.ts`). Module 16: schools (no Main/Sub distinction; every school starts PENDING). */
export const schoolApiDoc: ModuleApiDoc = {
  moduleId: '16',
  mountPath: '/schools',
  tag: { name: 'Schools', description: 'School creation and public submission, the approval workflow, GPS correction and manager assignment.' },
  operations: [
    {
      method: 'post',
      path: '/',
      operationId: 'createSchool',
      summary: 'Create a school',
      description:
        "Creates a PENDING school in the given organization with a gap-free code (`SC-000001`...). It grants the creator nothing; the organization's manager approves it later (`POST /schools/{id}/approve`). The name is unique within the organization. The school takes its organization's country.",
      authorization: orgManager(SchoolPermissions.CREATE, 'The organization named in the body.'),
      request: {
        description: 'The organization and the school with its address and GPS.',
        schema: s.object({ organizationId: s.uuid({ example: ORG_ID }), school: schoolForm({}) }, ['organizationId', 'school']),
        examples: {
          school: {
            summary: 'A school',
            value: { organizationId: ORG_ID, school: { name: 'Al-Huda Quran School', governorateId: GOVERNORATE_ID, gps: gpsExample } },
          },
        },
      },
      success: { status: 201, description: 'The school was created (PENDING).', data: ref('School'), example: schoolExample({ status: 'PENDING' }) },
      errors: [
        ...addressErrors,
        NOT_ALLOWED,
        { status: 409, codes: ['SCHOOL_NAME_ALREADY_EXISTS', 'SCHOOL_CONCURRENT_MODIFICATION'], description: 'The name is already used in the organization, or a concurrent update could not be resolved.' },
        { status: 422, codes: ['SCHOOL_ORGANIZATION_INACTIVE'], description: 'The organization is inactive.' },
      ],
    },
    {
      method: 'post',
      path: '/submissions',
      operationId: 'submitSchool',
      summary: 'Submit a school request (public)',
      description:
        "Public form for a new school of an ACTIVE organization. The school is created PENDING and grants nothing until the organization's manager approves it. Login is optional: without a token a new account is created for the applicant (password generated and never returned); with a token the applicant is the logged-in user. A per-IP abuse limit applies. A token that is sent must be valid.",
      authorization: {
        authentication: 'optional',
        roles: [],
        scope: 'None. The applicant gets no role until the request is approved.',
        enforcement: 'Public endpoint with an optional Bearer token and a per-client-IP abuse limit (10 requests per hour).',
        permissionId: null,
        decision: 'PROVISIONAL',
        reference: REFERENCE,
      },
      request: {
        description: 'The applicant, the organization and the school with its address and GPS.',
        schema: s.object(
          {
            applicant: s.object({ name: s.string({ maxLength: 200, example: 'Mona Hassan' }), phone: s.string({ maxLength: 40, example: '+201002345678' }) }, ['name', 'phone']),
            organizationId: s.uuid({ example: ORG_ID }),
            school: schoolForm({}),
          },
          ['applicant', 'organizationId', 'school'],
        ),
        examples: {
          submission: {
            summary: 'A school request',
            value: {
              applicant: { name: 'Mona Hassan', phone: '+201002345678' },
              organizationId: ORG_ID,
              school: { name: 'Al-Huda Branch', governorateId: GOVERNORATE_ID, gps: gpsExample },
            },
          },
        },
      },
      success: {
        status: 201,
        description: 'The request was created (PENDING).',
        data: ref('SchoolSubmission'),
        example: {
          school: schoolExample({ code: 'SC-000002', name: 'Al-Huda Branch', status: 'PENDING', applicantUserId: USER_ID, applicantName: 'Mona Hassan' }),
          applicant: { userId: USER_ID, accountCreated: true },
        },
      },
      errors: [
        {
          status: 400,
          codes: ['INVALID_APPLICANT_NAME', 'INVALID_PHONE_NUMBER', 'INVALID_SCHOOL_NAME', 'INVALID_GPS_COORDINATES', 'GPS_ACCURACY_EXCEEDS_LIMIT', 'SCHOOL_COUNTRY_MISMATCH', 'PARENT_ADDRESS_COUNTRY_MISMATCH', 'INVALID_GEOGRAPHY_HIERARCHY', 'GEOGRAPHY_NODE_INACTIVE'],
          description: 'A business validation failed.',
        },
        { status: 404, codes: ['GEOGRAPHY_NODE_NOT_FOUND', 'ORGANIZATION_NOT_FOUND'], description: 'The governorate or the organization does not exist.' },
        {
          status: 409,
          codes: ['SCHOOL_NAME_ALREADY_EXISTS', 'USER_PHONE_ALREADY_EXISTS', 'SCHOOL_APPLICANT_IDENTITY_MISMATCH', 'SCHOOL_CONCURRENT_MODIFICATION'],
          description: 'The name is taken, or the phone belongs to an existing account and the applicant is not logged in as that account.',
        },
        { status: 422, codes: ['SCHOOL_ORGANIZATION_INACTIVE', 'SCHOOL_MANAGER_NOT_ELIGIBLE'], description: 'The organization is inactive, or the logged-in applicant is not eligible.' },
      ],
      rateLimited: true,
    },
    {
      method: 'get',
      path: '/',
      operationId: 'listSchools',
      summary: 'List the schools the caller may see',
      description:
        "A paginated list of the schools of the organizations the caller manages, or the school the caller manages. Only the FIRST sort field is applied. Filter: `filter[status]` (comma-separated list allowed).",
      authorization: {
        authentication: 'required',
        roles: ['ORGANIZATION_MANAGER', 'SCHOOL_MANAGER'],
        scope: "The caller's own organizations or school (derived from the caller's manager links, never from the request).",
        enforcement: 'Authorization Engine permission (unscoped); the list itself is limited to the caller\'s own links by the application service.',
        permissionId: SchoolPermissions.LIST,
        decision: 'APPROVED',
        reference: REFERENCE,
      },
      query: listQueryParameters(SCHOOL_LIST_SPEC),
      success: { status: 200, description: 'A page of schools.', paginated: true, data: ref('School'), example: schoolExample() },
      errors: [NOT_ALLOWED],
    },
    {
      method: 'get',
      path: '/:id',
      operationId: 'getSchool',
      summary: 'Get one school',
      description: "Returns the school to the manager of its organization or to its own school manager. Anyone else gets 403.",
      authorization: {
        authentication: 'required',
        roles: ['ORGANIZATION_MANAGER', 'SCHOOL_MANAGER'],
        scope: "The manager of the school's organization, or the active manager of that exact school.",
        enforcement: ENFORCEMENT.replace('MAIN_ADMIN has no school permission.', 'A SCHOOL_MANAGER is covered only for their own school.'),
        permissionId: SchoolPermissions.READ,
        decision: 'APPROVED',
        reference: REFERENCE,
      },
      pathParams: schoolIdParam,
      success: { status: 200, description: 'The school.', data: ref('School'), example: schoolExample() },
      errors: [NOT_ALLOWED, notFound],
    },
    {
      method: 'post',
      path: '/:id/approve',
      operationId: 'approveSchool',
      summary: 'Approve a PENDING school',
      description:
        'In ONE transaction: the school becomes ACTIVE, the requester (when there is one) becomes its manager, the SCHOOL_MANAGER role is assigned when not already held, history is written and the events are published. Nothing changes if any part fails.',
      authorization: orgManager(SchoolPermissions.APPROVE, "The school's organization."),
      pathParams: schoolIdParam,
      success: {
        status: 200,
        description: 'The school is ACTIVE; `manager` is the requester\'s link, or null when the school was created by an organization manager.',
        data: ref('SchoolApproval'),
        example: { school: schoolExample({ decidedBy: USER_ID, decidedAt: '2026-10-15T10:00:00.000Z' }), manager: managerExample },
      },
      errors: [
        NOT_ALLOWED,
        notFound,
        concurrent,
        {
          status: 422,
          codes: ['SCHOOL_INVALID_STATUS_TRANSITION', 'SCHOOL_ORGANIZATION_INACTIVE', 'SCHOOL_MANAGER_NOT_ELIGIBLE'],
          description: "The school is not PENDING, its organization is inactive, or the requester's account is no longer eligible.",
        },
      ],
    },
    {
      method: 'post',
      path: '/:id/reject',
      operationId: 'rejectSchool',
      summary: 'Reject a PENDING school',
      description:
        'Rejects the request with a mandatory reason. REJECTED is terminal; the account and roles of the requester are untouched and the name is released. The `SchoolRejected` event is published for the notification (delivered by the notification modules).',
      authorization: orgManager(SchoolPermissions.REJECT, "The school's organization."),
      pathParams: schoolIdParam,
      request: {
        description: 'The reason for the rejection.',
        schema: s.object({ reason: s.string({ maxLength: 500, example: 'The GPS location does not match the stated address.' }) }, ['reason']),
        examples: { reject: { summary: 'Reject with a reason', value: { reason: 'The GPS location does not match the stated address.' } } },
      },
      success: {
        status: 200,
        description: 'The school is REJECTED.',
        data: ref('School'),
        example: schoolExample({ status: 'REJECTED', decidedBy: USER_ID, decidedAt: '2026-10-15T10:00:00.000Z', rejectionReason: 'The GPS location does not match the stated address.' }),
      },
      errors: [
        { status: 400, codes: ['INVALID_REJECTION_REASON'], description: 'The reason is empty after trimming or too long.' },
        NOT_ALLOWED,
        notFound,
        concurrent,
        { status: 422, codes: ['SCHOOL_INVALID_STATUS_TRANSITION', 'SCHOOL_ORGANIZATION_INACTIVE'], description: 'The school is not PENDING, or its organization is inactive.' },
      ],
    },
    statusChange('deactivate', SchoolPermissions.DEACTIVATE, 'Deactivate a school', 'Moves an ACTIVE school to INACTIVE (history and audit are kept).', 'INACTIVE'),
    statusChange('reactivate', SchoolPermissions.REACTIVATE, 'Reactivate a school', 'Moves an INACTIVE school back to ACTIVE.', 'ACTIVE'),
    {
      method: 'patch',
      path: '/:id/gps',
      operationId: 'correctSchoolGps',
      summary: 'Correct the GPS of a PENDING school',
      description: 'Only while the school is PENDING (the correction is audited). After approval the GPS is immutable (`SCHOOL_GPS_LOCKED`).',
      authorization: orgManager(SchoolPermissions.CORRECT_GPS, "The school's organization."),
      pathParams: schoolIdParam,
      request: {
        description: 'The corrected GPS reading.',
        schema: s.object({ gps: ref('Gps') }, ['gps']),
        examples: { gps: { summary: 'Corrected GPS', value: { gps: gpsExample } } },
      },
      success: { status: 200, description: 'The school with the corrected GPS.', data: ref('School'), example: schoolExample({ status: 'PENDING' }) },
      errors: [gpsErrors, NOT_ALLOWED, notFound, concurrent, { status: 422, codes: ['SCHOOL_GPS_LOCKED', 'SCHOOL_ORGANIZATION_INACTIVE'], description: 'The school is no longer PENDING, or its organization is inactive.' }],
    },
    {
      method: 'put',
      path: '/:id/manager',
      operationId: 'assignSchoolManager',
      summary: 'Assign the school manager',
      description:
        'Links an eligible user as the manager of the ACTIVE school and assigns the SCHOOL_MANAGER role when not already held. A school has at most one active manager; the history is kept.',
      authorization: orgManager(SchoolPermissions.ASSIGN_MANAGER, "The school's organization."),
      pathParams: schoolIdParam,
      request: {
        description: 'The user to assign.',
        schema: s.object({ userId: s.uuid({ example: USER_ID }) }, ['userId']),
        examples: { assign: { summary: 'Assign a manager', value: { userId: USER_ID } } },
      },
      success: { status: 200, description: 'The active manager link.', data: ref('SchoolManagerAssignment'), example: { ...managerExample, source: 'ASSIGNMENT' } },
      errors: [
        NOT_ALLOWED,
        notFound,
        { status: 409, codes: ['SCHOOL_ALREADY_HAS_MANAGER', 'SCHOOL_CONCURRENT_MODIFICATION'], description: 'The school already has an active manager, or a concurrent update could not be resolved.' },
        { status: 422, codes: ['SCHOOL_NOT_ACTIVE', 'SCHOOL_MANAGER_NOT_ELIGIBLE', 'SCHOOL_ORGANIZATION_INACTIVE'], description: 'The school is not ACTIVE, the user is not eligible, or the organization is inactive.' },
      ],
    },
    {
      method: 'delete',
      path: '/:id/manager',
      operationId: 'revokeSchoolManager',
      summary: 'End the active manager link',
      description: "Ends the school's active manager link (history is kept). The SCHOOL_MANAGER role is removed only when the user manages no other school.",
      authorization: orgManager(SchoolPermissions.REVOKE_MANAGER, "The school's organization."),
      pathParams: schoolIdParam,
      success: { status: 200, description: 'The ended manager link.', data: ref('SchoolManagerAssignment'), example: { ...managerExample, isActive: false, revokedAt: '2026-10-16T08:00:00.000Z', revokedBy: USER_ID } },
      errors: [
        NOT_ALLOWED,
        { status: 404, codes: ['SCHOOL_NOT_FOUND', 'SCHOOL_MANAGER_ASSIGNMENT_NOT_FOUND'], description: 'The school does not exist or has no active manager.' },
        concurrent,
      ],
    },
  ],
  schemas: {
    Gps: gpsSchema,
    School: s.object(
      {
        id: s.uuid(),
        code: s.string({ description: 'Gap-free code such as `SC-000001`.', example: 'SC-000001' }),
        name: s.string(),
        status: s.string({ enum: SCHOOL_STATUSES }),
        organizationId: s.uuid(),
        countryId: s.uuid({ description: "Always the organization's country." }),
        governorateId: s.uuid(),
        centerName: s.string({ nullable: true, description: 'Free text.' }),
        villageName: s.string({ nullable: true, description: 'Free text.' }),
        gps: ref('Gps'),
        createdBy: s.uuid({ description: 'The user who created the school or submitted the request.' }),
        applicantUserId: s.uuid({ nullable: true, description: 'The applicant of a public submission; null when an organization manager created the school.' }),
        applicantName: s.string({ nullable: true, description: "The applicant's name as submitted." }),
        decidedBy: s.uuid({ nullable: true }),
        decidedAt: s.dateTime({ nullable: true }),
        rejectionReason: s.string({ nullable: true }),
        createdAt: s.dateTime(),
        updatedAt: s.dateTime(),
      },
      ['id', 'code', 'name', 'status', 'organizationId', 'countryId', 'governorateId', 'centerName', 'villageName', 'gps', 'createdBy', 'applicantUserId', 'applicantName', 'decidedBy', 'decidedAt', 'rejectionReason', 'createdAt', 'updatedAt'],
    ),
    SchoolManagerAssignment: managerSchema,
    SchoolManagerOrNone: { ...managerSchema, nullable: true, description: 'The manager link, or null when the school has no requester to promote.' },
    SchoolSubmission: s.object(
      { school: ref('School'), applicant: s.object({ userId: s.uuid(), accountCreated: s.boolean({ description: 'true when a new account was created for the applicant; never a password or token.' }) }, ['userId', 'accountCreated']) },
      ['school', 'applicant'],
    ),
    SchoolApproval: s.object({ school: ref('School'), manager: ref('SchoolManagerOrNone') }, ['school', 'manager']),
  },
};
