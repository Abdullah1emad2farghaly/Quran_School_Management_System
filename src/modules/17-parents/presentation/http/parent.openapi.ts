import { listQueryParameters, ref, schema as s, type AuthorizationDoc, type ErrorDoc, type ModuleApiDoc } from '../../../04-validation-api/public';
import { ParentPermissions } from '../../application/services/parent-authorization';
import { PARENT_LIST_SPEC } from './parent-routes';

const PARENT_ID = '5d8e2a14-7b36-4c09-9f21-a8c4e6b0d173';
const USER_ID = '3f6b1d52-8a4e-4c1b-9d77-2b6f0c9a1e10';
const SCHOOL_ID = '9a4e7c21-6d03-4b58-8e1f-0c2d5b7a3f64';
const OTHER_SCHOOL_ID = 'c47a19e0-3d58-4e6b-b2f1-90a7d5c3e812';
const ORG_ID = '7c1d5e93-2b8a-4f60-a1d4-9e3b6c0f8a21';
const GOVERNORATE_ID = '1e9d4c7b-0a62-4b8f-9c35-d7f1a2b6e840';
const LINK_ID = 'b81f3c60-2e94-4a75-8d06-f1e2a9c47b35';

const REFERENCE = 'docs/AUTHORIZATION-MATRIX.md (Parents 17); docs/PARENTS.md';
const MANAGER_ENFORCEMENT =
  'Enforced by the Authorization Engine (deny by default): the caller must hold the SCHOOL_MANAGER role AND an active manager link to the school (for a Parent: to at least one school the Parent is actively linked to). The scope is loaded server-side. ORGANIZATION_MANAGER and MAIN_ADMIN have no Parent permission.';

const schoolManager = (permissionId: string, scope: string): AuthorizationDoc => ({
  authentication: 'required',
  roles: ['SCHOOL_MANAGER'],
  scope,
  enforcement: MANAGER_ENFORCEMENT,
  permissionId,
  decision: 'APPROVED',
  reference: REFERENCE,
});

const NOT_ALLOWED: ErrorDoc = { status: 403, codes: ['ACCESS_DENIED', 'PASSWORD_CHANGE_REQUIRED'], description: 'The caller lacks the permission or the scope (no reason is given), or the account must first change its initial password.' };
const notFound: ErrorDoc = { status: 404, codes: ['PARENT_NOT_FOUND'], description: 'The Parent does not exist.' };
const addressErrors: ErrorDoc = {
  status: 400,
  codes: ['INVALID_PARENT_NAME', 'PARENT_ADDRESS_REQUIRED', 'PARENT_UPDATE_EMPTY', 'INVALID_PARENT_ADDRESS', 'PARENT_ADDRESS_GOVERNORATE_NOT_FOUND', 'PARENT_ADDRESS_GOVERNORATE_INACTIVE', 'PARENT_ADDRESS_COUNTRY_MISMATCH', 'INVALID_PHONE_NUMBER'],
  description:
    'The name does not have exactly three parts, the phone is malformed, the address is missing/ambiguous (send `address` OR `addressFields`), an update carries no address (`PARENT_UPDATE_EMPTY`), or the address is invalid: the governorate must be a registered, ACTIVE governorate of the organization\'s country (exact name match for the raw text), a village needs a center/city.',
};

const addressSchema = s.object(
  {
    governorateId: s.uuid({ example: GOVERNORATE_ID }),
    governorateName: s.string({ description: 'The governorate name as stored with this address (a snapshot: it keeps reading the same if the governorate is renamed).', example: 'المنيا' }),
    centerName: s.string({ nullable: true, description: 'Free text (center or city).', example: 'سمالوط' }),
    villageName: s.string({ nullable: true, description: 'Free text. Never present without a center/city.', example: 'برمشا' }),
    since: s.dateTime({ description: 'When this address became the current one.' }),
  },
  ['governorateId', 'governorateName', 'centerName', 'villageName', 'since'],
);

const parentSchema = s.object(
  {
    id: s.uuid(),
    userId: s.uuid({ description: 'The login account (Module 08).' }),
    organizationId: s.uuid({ description: 'The organization of the school that registered the Parent. Never changes.' }),
    name: s.string({ description: 'The account\'s canonical personal name: exactly three parts (stored once, on the account).', example: 'أحمد محمد علي' }),
    phone: s.string({ description: 'The normalized phone number (the login identifier).', example: '+201001234567' }),
    address: ref('ParentAddress'),
    schoolIds: s.array(s.uuid(), { description: 'The schools the Parent is currently linked to (all in the same organization).' }),
    createdAt: s.dateTime(),
    updatedAt: s.dateTime(),
  },
  ['id', 'userId', 'organizationId', 'name', 'phone', 'address', 'schoolIds', 'createdAt', 'updatedAt'],
);

const linkSchema = s.object(
  {
    id: s.uuid(),
    parentId: s.uuid(),
    schoolId: s.uuid(),
    linkedAt: s.dateTime(),
    linkedBy: s.uuid(),
    unlinkedAt: s.dateTime({ nullable: true }),
    unlinkedBy: s.uuid({ nullable: true }),
    isActive: s.boolean(),
  },
  ['id', 'parentId', 'schoolId', 'linkedAt', 'linkedBy', 'unlinkedAt', 'unlinkedBy', 'isActive'],
);

const addressExample = {
  governorateId: GOVERNORATE_ID,
  governorateName: 'المنيا',
  centerName: 'سمالوط',
  villageName: 'برمشا',
  since: '2026-10-18T09:30:00.000Z',
};
const parentExample = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: PARENT_ID,
  userId: USER_ID,
  organizationId: ORG_ID,
  name: 'أحمد محمد علي',
  phone: '+201001234567',
  address: addressExample,
  schoolIds: [SCHOOL_ID],
  createdAt: '2026-10-18T09:30:00.000Z',
  updatedAt: '2026-10-18T09:30:00.000Z',
  ...overrides,
});
const linkExample = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: LINK_ID,
  parentId: PARENT_ID,
  schoolId: SCHOOL_ID,
  linkedAt: '2026-10-18T09:30:00.000Z',
  linkedBy: USER_ID,
  unlinkedAt: null,
  unlinkedBy: null,
  isActive: true,
  ...overrides,
});

const addressFieldsSchema = s.object(
  {
    governorateId: s.uuid({ example: GOVERNORATE_ID, description: 'A registered, ACTIVE governorate of the organization\'s country.' }),
    centerName: s.string({ nullable: true, maxLength: 1000, description: 'Optional free text (center or city).', example: 'سمالوط' }),
    villageName: s.string({ nullable: true, maxLength: 1000, description: 'Optional free text; needs a center/city.', example: 'برمشا' }),
  },
  ['governorateId'],
);
const ADDRESS_TEXT = s.string({
  maxLength: 600,
  description:
    'The address as `Governorate / Center or City / Village` (only `/` separates; trailing parts may be omitted). The governorate must match a registered governorate of the organization\'s country EXACTLY (no Arabic letter folding). Send this OR `addressFields`.',
  example: 'المنيا / سمالوط / برمشا',
});
const ADDRESS_FIELDS_DESCRIPTION = 'The same address as structured fields. Send this OR `address`, never both. The country is never an input: it is the country of the organization.';

const parentIdParam = { id: { description: 'The Parent id.', example: PARENT_ID, schema: s.uuid() } };
const schoolIdParam = { schoolId: { description: 'The school id.', example: SCHOOL_ID, schema: s.uuid() } };

/** OpenAPI contract of `/parents` (`parent-routes.ts`). Module 17: parents. */
export const parentApiDoc: ModuleApiDoc = {
  moduleId: '17',
  mountPath: '/parents',
  tag: {
    name: 'Parents',
    description:
      'Parent registration by the School Manager (with account reuse inside the same organization), the Parent Address with history, the Parent-to-School relationship, and the Parent\'s own profile.',
  },
  operations: [
    {
      method: 'post',
      path: '/',
      operationId: 'registerParent',
      summary: 'Register a Parent (or reuse the existing one) for a school',
      description:
        'The School Manager registers a Parent of THEIR school with a three-part personal name, a phone number and an address (the country is the organization\'s). **New phone:** a new account is created with the last four digits of the phone as its initial password and the mandatory first-login password change (the Parent can use nothing but `POST /auth/change-password` and logout until it is changed); the PARENT role is assigned. **Existing phone:** the account is never merged, overwritten or given a new password. The account is matched by the canonical three-part name stored on the account: the same name reuses the account and links it to this school (the stored name, password and address are never changed; use `PATCH /parents/{id}` for the address) - for an existing Parent of the same organization, or for an account that holds another role such as ORGANIZATION_MANAGER or SCHOOL_MANAGER, which then also receives the PARENT role. A different name, an account with no stored name, or any other identity that cannot be matched is `PARENT_IDENTITY_CONFLICT`; a deactivated account is `PARENT_ACCOUNT_INACTIVE`. A matching name is the approved matching criterion, not independent proof of identity; a Parent of another organization is `PARENT_ORGANIZATION_CONFLICT`. Linking the same school twice is `PARENT_ALREADY_LINKED_TO_SCHOOL`. The password is never returned.',
      authorization: schoolManager(ParentPermissions.CREATE, 'The school named in the body (the caller must be its active manager).'),
      request: {
        description: 'The school, the Parent\'s name and phone, and the address (as text OR as fields).',
        schema: s.object(
          {
            schoolId: s.uuid({ example: SCHOOL_ID }),
            name: s.string({ maxLength: 200, description: 'The Parent\'s personal name: EXACTLY three parts (two or four parts are `INVALID_PARENT_NAME`).', example: 'أحمد محمد علي' }),
            phone: s.string({ maxLength: 40, description: 'Any accepted phone format; normalized to E.164.', example: '01001234567' }),
            address: ADDRESS_TEXT,
            addressFields: addressFieldsSchema,
          },
          ['schoolId', 'name', 'phone'],
        ),
        examples: {
          addressAsText: { summary: 'Address as Governorate / Center / Village', value: { schoolId: SCHOOL_ID, name: 'أحمد محمد علي', phone: '01001234567', address: 'المنيا / سمالوط / برمشا' } },
          addressAsFields: {
            summary: 'Address as fields',
            value: { schoolId: SCHOOL_ID, name: 'أحمد محمد علي', phone: '01001234567', addressFields: { governorateId: GOVERNORATE_ID, centerName: 'سمالوط', villageName: 'برمشا' } },
          },
        },
      },
      success: { status: 201, description: 'The Parent was registered (or reused) and linked to the school.', data: ref('ParentRegistration'), example: { parent: parentExample(), link: linkExample(), accountCreated: true } },
      errors: [
        addressErrors,
        NOT_ALLOWED,
        { status: 409, codes: ['PARENT_IDENTITY_CONFLICT', 'PARENT_ORGANIZATION_CONFLICT', 'PARENT_ALREADY_LINKED_TO_SCHOOL', 'PARENT_CONCURRENT_MODIFICATION', 'USER_PHONE_ALREADY_EXISTS'], description: 'The phone belongs to an account that cannot be reused for this Parent, the Parent is already linked, or a concurrent registration could not be resolved (retry).' },
        { status: 422, codes: ['PARENT_SCHOOL_NOT_ACTIVE', 'PARENT_ACCOUNT_INACTIVE'], description: 'The school does not exist or is not ACTIVE, or the existing account is deactivated.' },
      ],
    },
    {
      method: 'get',
      path: '/me',
      operationId: 'getOwnParentProfile',
      summary: 'The caller\'s own Parent profile',
      description: 'A Parent reads their own profile (name, phone, current address, linked schools). No id is accepted: the record is the one of the verified token. V1: a Parent cannot edit their own address or name.',
      authorization: {
        authentication: 'required',
        roles: ['PARENT'],
        scope: 'The caller\'s own Parent record (derived from the access token).',
        enforcement: 'Authorization Engine permission (unscoped); the record is looked up by the verified user id, never by a client-supplied id.',
        permissionId: ParentPermissions.READ_OWN,
        decision: 'APPROVED',
        reference: REFERENCE,
      },
      success: { status: 200, description: 'The caller\'s Parent profile.', data: ref('Parent'), example: parentExample() },
      errors: [NOT_ALLOWED, notFound],
    },
    {
      method: 'get',
      path: '/schools/:schoolId',
      operationId: 'listSchoolParents',
      summary: 'List the Parents of a school',
      description: 'A paginated list of the Parents with an ACTIVE link to the school, newest first by default (`sort=createdAt` or `-createdAt`; the name cannot be sorted: it lives on the account, data of another module).',
      authorization: schoolManager(ParentPermissions.LIST, 'The school in the path (the caller must be its active manager).'),
      pathParams: schoolIdParam,
      query: listQueryParameters(PARENT_LIST_SPEC),
      success: { status: 200, description: 'A page of Parents.', paginated: true, data: ref('Parent'), example: parentExample() },
      errors: [NOT_ALLOWED],
    },
    {
      method: 'get',
      path: '/:id',
      operationId: 'getParent',
      summary: 'Get one Parent',
      description: 'Returns the Parent to a School Manager of any school the Parent is actively linked to. A Parent linked only to other schools is `403 ACCESS_DENIED`.',
      authorization: schoolManager(ParentPermissions.READ, 'A school the Parent is actively linked to (loaded server-side).'),
      pathParams: parentIdParam,
      success: { status: 200, description: 'The Parent.', data: ref('Parent'), example: parentExample() },
      errors: [NOT_ALLOWED, notFound],
    },
    {
      method: 'patch',
      path: '/:id',
      operationId: 'updateParent',
      summary: 'Correct a Parent\'s address',
      description:
        'Changes the Parent\'s address. A new address becomes the current one and the previous address stays in the history (with the governorate name as it was). An unchanged address changes nothing. The name (the account\'s canonical name, shared by every role of the account), the phone, the organization and the account (password, status, roles) are never changed here. `address` or `addressFields` is required (`PARENT_UPDATE_EMPTY`).',
      authorization: schoolManager(ParentPermissions.UPDATE, 'A school the Parent is actively linked to (loaded server-side).'),
      pathParams: parentIdParam,
      request: {
        description: 'The corrected address (as text OR as fields).',
        schema: s.object(
          {
            address: ADDRESS_TEXT,
            addressFields: s.object(
              {
                governorateId: s.uuid({ example: GOVERNORATE_ID }),
                centerName: s.string({ nullable: true, maxLength: 1000, example: 'سمالوط' }),
                villageName: s.string({ nullable: true, maxLength: 1000, example: 'برمشا' }),
              },
              ['governorateId'],
              { description: ADDRESS_FIELDS_DESCRIPTION },
            ),
          },
          [],
        ),
        examples: { newAddress: { summary: 'Move the Parent to a new address', value: { address: 'المنيا / مطاي' } } },
      },
      success: { status: 200, description: 'The Parent after the change.', data: ref('Parent'), example: parentExample({ address: { ...addressExample, centerName: 'مطاي', villageName: null } }) },
      errors: [
        addressErrors,
        NOT_ALLOWED,
        notFound,
        { status: 409, codes: ['PARENT_CONCURRENT_MODIFICATION'], description: 'A concurrent update could not be resolved; retry.' },
      ],
    },
    {
      method: 'delete',
      path: '/:id/schools/:schoolId',
      operationId: 'removeParentSchoolLink',
      summary: 'End a Parent\'s link to one school',
      description:
        'Ends the Parent-to-School relationship for THIS school only, and only while the Parent has no students in this school (`PARENT_HAS_STUDENTS_IN_SCHOOL`; enforced through the Students module guard). The login account, the Parent record, the address history and the links to other schools are untouched, and the ended link stays in the history. There is no global deactivation or deletion of a Parent in V1.',
      authorization: schoolManager(ParentPermissions.REMOVE_SCHOOL_LINK, 'The school in the path (the caller must be its active manager).'),
      pathParams: { ...parentIdParam, ...schoolIdParam },
      success: { status: 200, description: 'The ended link.', data: ref('ParentSchoolLink'), example: linkExample({ schoolId: OTHER_SCHOOL_ID, unlinkedAt: '2026-10-19T08:00:00.000Z', unlinkedBy: USER_ID, isActive: false }) },
      errors: [
        NOT_ALLOWED,
        { status: 404, codes: ['PARENT_NOT_FOUND', 'PARENT_SCHOOL_LINK_NOT_FOUND'], description: 'The Parent does not exist, or is not linked to this school.' },
        { status: 409, codes: ['PARENT_CONCURRENT_MODIFICATION'], description: 'A concurrent update could not be resolved; retry.' },
        { status: 422, codes: ['PARENT_HAS_STUDENTS_IN_SCHOOL'], description: 'The Parent still has students in this school; the relationship cannot be removed.' },
      ],
    },
  ],
  schemas: {
    ParentAddress: addressSchema,
    Parent: parentSchema,
    ParentSchoolLink: linkSchema,
    ParentRegistration: s.object(
      {
        parent: ref('Parent'),
        link: ref('ParentSchoolLink'),
        accountCreated: s.boolean({ description: 'True when a NEW login account was created (initial password + mandatory first-login change); false when an existing account was reused.' }),
      },
      ['parent', 'link', 'accountCreated'],
    ),
  },
};
