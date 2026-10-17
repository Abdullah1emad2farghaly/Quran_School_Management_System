import { listQueryParameters, ref, schema as s, type AuthorizationDoc, type ErrorDoc, type ModuleApiDoc } from '../../../04-validation-api/public';
import { ORGANIZATION_STATUSES, OrganizationPermissions } from '../../../13-organization-core/public';
import { ORGANIZATION_LIST_SPEC } from './organization-routes';

const ORG_ID = '7c1d5e93-2b8a-4f60-a1d4-9e3b6c0f8a21';
const COUNTRY_ID = 'b2f0a8d1-5c34-4e7a-8d19-6a3c7e1f0b52';
const GOVERNORATE_ID = '1e9d4c7b-0a62-4b8f-9c35-d7f1a2b6e840';
const USER_ID = '3f6b1d52-8a4e-4c1b-9d77-2b6f0c9a1e10';

/** Who may do what with organizations: copied from docs/AUTHORIZATION-MATRIX.md ("Organization scope"), never invented. */
const organizationManager = (permissionId: string, scope: string): AuthorizationDoc => ({
  authentication: 'required',
  roles: ['ORGANIZATION_MANAGER'],
  scope,
  enforcement:
    'Enforced by the Authorization Engine (deny by default): the caller must hold the ORGANIZATION_MANAGER role AND have an active manager link to exactly that organization. MAIN_ADMIN has no organization permission.',
  permissionId,
  decision: 'APPROVED',
  reference: 'docs/AUTHORIZATION-MATRIX.md, "Organization scope"; docs/ORGANIZATION.md',
});

/** Address and name validation answers shared by the registration endpoint. */
const registrationErrors: ErrorDoc[] = [
  {
    status: 400,
    codes: [
      'INVALID_APPLICANT_NAME',
      'INVALID_PHONE_NUMBER',
      'INVALID_ORGANIZATION_NAME',
      'ORGANIZATION_COUNTRY_INVALID',
      'INVALID_PARENT_ADDRESS',
      'ORGANIZATION_ADDRESS_COUNTRY_MISMATCH',
      'INVALID_GEOGRAPHY_HIERARCHY',
      'GEOGRAPHY_NODE_INACTIVE',
    ],
    description: 'A business validation failed (name, phone, country or address hierarchy).',
  },
  { status: 404, codes: ['GEOGRAPHY_NODE_NOT_FOUND'], description: 'The governorate, center or village does not exist.' },
  {
    status: 409,
    codes: ['ORGANIZATION_NAME_ALREADY_EXISTS', 'USER_PHONE_ALREADY_EXISTS', 'SCHOOL_APPLICANT_IDENTITY_MISMATCH'],
    description: 'The name is taken, or the phone belongs to an existing account and the applicant is not logged in as that account.',
  },
  { status: 422, codes: ['SCHOOL_MANAGER_NOT_ELIGIBLE'], description: 'The logged-in applicant\'s account is not active.' },
];

/** OpenAPI contract of `/organizations` (`organization-routes.ts`). Module 16 (Schools) owns the registration workflow. */
export const organizationApiDoc: ModuleApiDoc = {
  moduleId: '16',
  mountPath: '/organizations',
  tag: { name: 'Organizations', description: 'Register an organization and read the organizations the caller administers.' },
  operations: [
    {
      method: 'post',
      path: '/',
      operationId: 'registerOrganization',
      summary: 'Register an organization (public)',
      description:
        'Creates an ACTIVE organization with its country and address, and makes the applicant its ORGANIZATION_MANAGER (of THIS organization only). Login is optional: without a token a new account is created for the applicant (its password is generated and never returned: the applicant uses password recovery); with a token the applicant is the logged-in user. The organization name is unique system-wide. A per-IP abuse limit applies.',
      authorization: {
        authentication: 'optional',
        roles: [],
        scope: 'None for the caller; the applicant becomes ORGANIZATION_MANAGER of the new organization only.',
        enforcement: 'Public endpoint with an optional Bearer token and a per-client-IP abuse limit (10 requests per hour). A token that is sent must be valid.',
        permissionId: null,
        decision: 'APPROVED',
        reference: 'docs/AUTHORIZATION-MATRIX.md, "Organization scope"; docs/SCHOOLS.md',
      },
      request: {
        description: 'The applicant and the organization with its own address (country and governorate are required; center and village are optional).',
        schema: s.object(
          {
            applicant: s.object(
              { name: s.string({ maxLength: 200, example: 'Abdullah Emad Farghaly' }), phone: s.string({ maxLength: 40, example: '+201001234567' }) },
              ['name', 'phone'],
            ),
            organization: s.object(
              {
                name: s.string({ maxLength: 200, example: 'Al-Noor Quran Foundation' }),
                countryId: s.uuid({ example: COUNTRY_ID }),
                governorateId: s.uuid({ example: GOVERNORATE_ID }),
                centerName: s.string({ nullable: true, maxLength: 200, description: 'Optional free text (center or city).' }),
                villageName: s.string({ nullable: true, maxLength: 200, description: 'Optional free text.' }),
              },
              ['name', 'countryId', 'governorateId'],
            ),
          },
          ['applicant', 'organization'],
        ),
        examples: {
          register: {
            summary: 'Register an organization',
            value: {
              applicant: { name: 'Abdullah Emad Farghaly', phone: '+201001234567' },
              organization: { name: 'Al-Noor Quran Foundation', countryId: COUNTRY_ID, governorateId: GOVERNORATE_ID },
            },
          },
        },
      },
      success: {
        status: 201,
        description: 'The organization was created.',
        data: ref('OrganizationRegistration'),
        example: {
          organization: {
            id: ORG_ID,
            code: 'ORG-000002',
            name: 'Al-Noor Quran Foundation',
            status: 'ACTIVE',
            countryId: COUNTRY_ID,
            address: { governorateId: GOVERNORATE_ID, centerName: null, villageName: null },
            createdAt: '2026-10-15T09:30:00.000Z',
            updatedAt: '2026-10-15T09:30:00.000Z',
          },
          applicant: { userId: USER_ID, accountCreated: true },
        },
      },
      errors: registrationErrors,
      rateLimited: true,
    },
    {
      method: 'get',
      path: '/',
      operationId: 'listOrganizations',
      summary: 'List the organizations the caller administers',
      description:
        'A paginated list of the organizations the caller administers. `sort` is validated against the whitelist but the endpoint currently applies no client-chosen ordering; the order is the service default. No filters or search are supported.',
      authorization: organizationManager(OrganizationPermissions.LIST, 'The organizations the caller manages (derived from the caller\'s own links).'),
      query: listQueryParameters(ORGANIZATION_LIST_SPEC),
      errors: [{ status: 403, codes: ['ACCESS_DENIED'], description: 'The caller is not an ORGANIZATION_MANAGER.' }],
      success: {
        status: 200,
        description: 'A page of organizations.',
        paginated: true,
        data: ref('Organization'),
        example: {
          id: ORG_ID,
          code: 'ORG-000002',
          name: 'Al-Noor Quran Foundation',
          status: 'ACTIVE',
          countryId: COUNTRY_ID,
          address: { governorateId: GOVERNORATE_ID, centerName: null, villageName: null },
          createdAt: '2026-10-15T09:30:00.000Z',
          updatedAt: '2026-10-15T09:30:00.000Z',
        },
      },
    },
    {
      method: 'get',
      path: '/:id',
      operationId: 'getOrganization',
      summary: 'Get one organization',
      description: 'Returns the organization only to its own manager; anyone else (including managers of other organizations) gets 403.',
      authorization: organizationManager(OrganizationPermissions.READ, 'The organization named in the path, only for its own manager.'),
      pathParams: { id: { description: 'The organization id.', example: ORG_ID, schema: s.uuid() } },
      success: {
        status: 200,
        description: 'The organization.',
        data: ref('Organization'),
        example: {
          id: ORG_ID,
          code: 'ORG-000002',
          name: 'Al-Noor Quran Foundation',
          status: 'ACTIVE',
          countryId: COUNTRY_ID,
          address: { governorateId: GOVERNORATE_ID, centerName: null, villageName: null },
          createdAt: '2026-10-15T09:30:00.000Z',
          updatedAt: '2026-10-15T09:30:00.000Z',
        },
      },
      errors: [
        { status: 403, codes: ['ACCESS_DENIED'], description: 'The caller does not manage this organization (no reason is given).' },
        { status: 404, codes: ['ORGANIZATION_NOT_FOUND'], description: 'The organization does not exist.' },
      ],
    },
  ],
  schemas: {
    Organization: s.object(
      {
        id: s.uuid(),
        code: s.string({ description: 'Gap-free code such as `ORG-000002`.', example: 'ORG-000002' }),
        name: s.string(),
        status: s.string({ enum: ORGANIZATION_STATUSES }),
        countryId: s.uuid(),
        address: s.object({ governorateId: s.uuid(), centerName: s.string({ nullable: true }), villageName: s.string({ nullable: true }) }, ['governorateId', 'centerName', 'villageName']),
        createdAt: s.dateTime(),
        updatedAt: s.dateTime(),
      },
      ['id', 'code', 'name', 'status', 'countryId', 'address', 'createdAt', 'updatedAt'],
    ),
    OrganizationRegistration: s.object(
      {
        organization: ref('Organization'),
        applicant: s.object(
          {
            userId: s.uuid(),
            accountCreated: s.boolean({ description: 'true when a new account was created for the applicant; never a password or token.' }),
          },
          ['userId', 'accountCreated'],
        ),
      },
      ['organization', 'applicant'],
    ),
  },
};
