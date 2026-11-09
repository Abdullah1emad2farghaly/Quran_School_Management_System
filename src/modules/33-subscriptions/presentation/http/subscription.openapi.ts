import { listQueryParameters, ref, schema as s, type AuthorizationDoc, type ErrorDoc, type ModuleApiDoc } from '../../../04-validation-api/public';
import { SubscriptionPermissions } from '../../application/services/subscription-authorization';
import { COLLECTOR_LIST_SPEC, SUBSCRIPTION_LIST_SPEC } from './subscription-routes';

const SUBSCRIPTION_ID = '5d1c8e07-3a92-4b64-9f10-7e2a6c4b8d13';
const STUDENT_ID = '8b3e5f19-4c70-4d26-a1e8-2f9d6b0c7a45';
const USER_ID = '3f6b1d52-8a4e-4c1b-9d77-2b6f0c9a1e10';
const SCHOOL_ID = '9a4e7c21-6d03-4b58-8e1f-0c2d5b7a3f64';
const ORG_ID = '7c1d5e93-2b8a-4f60-a1d4-9e3b6c0f8a21';
const BATCH_ID = 'e2a7c940-1b35-4d68-8f0c-5a9d3e7b1c26';
const LINK_ID = 'b81f3c60-2e94-4a75-8d06-f1e2a9c47b35';

const REFERENCE = 'docs/AUTHORIZATION-MATRIX.md (Subscriptions 33); docs/SUBSCRIPTIONS.md';
const BOTH_ENFORCEMENT =
  'Enforced by the Authorization Engine (deny by default): the caller must hold the SCHOOL_MANAGER role AND an active manager link to the school, OR the SUBSCRIPTION_COLLECTOR role AND a CURRENTLY ACTIVE collector link to the school (an ended link grants nothing). For a subscription the school is the subscription\'s school, loaded server-side. ORGANIZATION_MANAGER, MAIN_ADMIN, PARENT and TEACHER have no subscription permission.';
const MANAGER_ENFORCEMENT = 'Enforced by the Authorization Engine (deny by default): the caller must hold the SCHOOL_MANAGER role AND an active manager link to the school. A Subscription Collector can never do this (they cannot waive and cannot manage Collectors).';

const managerOrCollector = (permissionId: string, scope: string): AuthorizationDoc => ({ authentication: 'required', roles: ['SCHOOL_MANAGER', 'SUBSCRIPTION_COLLECTOR'], scope, enforcement: BOTH_ENFORCEMENT, permissionId, decision: 'APPROVED', reference: REFERENCE });
const managerOnly = (permissionId: string, scope: string): AuthorizationDoc => ({ authentication: 'required', roles: ['SCHOOL_MANAGER'], scope, enforcement: MANAGER_ENFORCEMENT, permissionId, decision: 'APPROVED', reference: REFERENCE });

const NOT_ALLOWED: ErrorDoc = { status: 403, codes: ['ACCESS_DENIED', 'PASSWORD_CHANGE_REQUIRED'], description: 'The caller lacks the permission or the scope (no reason is given), or the account must first change its initial password.' };

const subscriptionSchema = s.object(
  {
    id: s.uuid(),
    studentId: s.uuid(),
    studentName: s.string({ nullable: true, description: 'The student\'s name, read from the Students module (present on reads and lists).' }),
    schoolId: s.uuid(),
    month: s.string({ pattern: '^\\d{4}-(0[1-9]|1[0-2])$', description: 'The subscription month `YYYY-MM` in Africa/Cairo.', example: '2026-11' }),
    status: s.string({ enum: ['PAID', 'UNPAID', 'WAIVED'], description: 'PAID, UNPAID or WAIVED. A subscription is only Student + Month + Status: there is no amount.' }),
    createdAt: s.dateTime(),
    paidAt: s.dateTime({ nullable: true }),
    waivedAt: s.dateTime({ nullable: true }),
    updatedAt: s.dateTime(),
  },
  ['id', 'studentId', 'schoolId', 'month', 'status', 'createdAt', 'paidAt', 'waivedAt', 'updatedAt'],
);

const collectorSchema = s.object(
  {
    userId: s.uuid({ description: 'The Collector\'s login account (Module 08).' }),
    organizationId: s.uuid(),
    name: s.string({ example: 'محمود سعيد علي' }),
    phone: s.string({ example: '+201001234569' }),
    schoolIds: s.array(s.uuid(), { description: 'The schools the Collector is currently linked to (all in the same organization).' }),
  },
  ['userId', 'organizationId', 'name', 'phone', 'schoolIds'],
);

const linkSchema = s.object(
  { id: s.uuid(), userId: s.uuid(), schoolId: s.uuid(), linkedAt: s.dateTime(), linkedBy: s.uuid(), unlinkedAt: s.dateTime({ nullable: true }), unlinkedBy: s.uuid({ nullable: true }), isActive: s.boolean() },
  ['id', 'userId', 'schoolId', 'linkedAt', 'linkedBy', 'unlinkedAt', 'unlinkedBy', 'isActive'],
);

const subscriptionExample = (o: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: SUBSCRIPTION_ID, studentId: STUDENT_ID, studentName: 'عمر أحمد محمد', schoolId: SCHOOL_ID, month: '2026-11', status: 'UNPAID',
  createdAt: '2026-11-08T09:00:00.000Z', paidAt: null, waivedAt: null, updatedAt: '2026-11-08T09:00:00.000Z', ...o,
});
const collectorExample = { userId: USER_ID, organizationId: ORG_ID, name: 'محمود سعيد علي', phone: '+201001234569', schoolIds: [SCHOOL_ID] };
const linkExample = (o: Record<string, unknown> = {}): Record<string, unknown> => ({ id: LINK_ID, userId: USER_ID, schoolId: SCHOOL_ID, linkedAt: '2026-11-08T09:00:00.000Z', linkedBy: USER_ID, unlinkedAt: null, unlinkedBy: null, isActive: true, ...o });

const schoolIdParam = { schoolId: { description: 'The school id.', example: SCHOOL_ID, schema: s.uuid() } };
const studentIdParam = { studentId: { description: 'The student id.', example: STUDENT_ID, schema: s.uuid() } };
const subscriptionIdParam = { id: { description: 'The subscription id.', example: SUBSCRIPTION_ID, schema: s.uuid() } };

/** OpenAPI contract of `/subscriptions` (`subscription-routes.ts`). Module 33: subscriptions. */
export const subscriptionApiDoc: ModuleApiDoc = {
  moduleId: '33',
  mountPath: '/subscriptions',
  tag: {
    name: 'Subscriptions',
    description: 'Monthly subscriptions (Student + Month + Status: PAID / UNPAID / WAIVED), the manual bulk creation for the current Africa/Cairo month, the Oldest-Unpaid Rule (enforced by the `markPaid` contract that Module 34 will call; there is no HTTP endpoint that marks a subscription PAID), waiving by the School Manager, and the Subscription Collector-to-School assignment.',
  },
  operations: [
    {
      method: 'post',
      path: '/schools/:schoolId/monthly',
      operationId: 'createMonthlySubscriptions',
      summary: 'Bulk-create the current month\'s subscriptions for a school',
      description:
        'Manually started by the School Manager or the school\'s Collector. The month is NEVER sent by the caller: it is the current month in Africa/Cairo. One UNPAID subscription is created for every ACTIVE student of the school, in one transaction. If the school already has the subscriptions of this month the answer is `409 SUBSCRIPTIONS_ALREADY_CREATED_FOR_MONTH` and nothing is created (also when two people start it at the same moment: exactly one succeeds). A school with no ACTIVE student gets `422 SUBSCRIPTION_NO_ACTIVE_STUDENTS`. Publishes `SubscriptionsCreated`; the Subscription Collector(s) of the school are notified.',
      authorization: managerOrCollector(SubscriptionPermissions.CREATE_MONTHLY, 'The school in the path.'),
      pathParams: schoolIdParam,
      success: { status: 201, description: 'The month was created.', data: ref('BulkCreationResult'), example: { batchId: BATCH_ID, schoolId: SCHOOL_ID, month: '2026-11', count: 42, createdAt: '2026-11-08T09:00:00.000Z' } },
      errors: [
        NOT_ALLOWED,
        { status: 409, codes: ['SUBSCRIPTIONS_ALREADY_CREATED_FOR_MONTH', 'SUBSCRIPTION_ALREADY_EXISTS'], description: 'The subscriptions of the current month were already created for this school (nothing is duplicated).' },
        { status: 422, codes: ['SUBSCRIPTION_SCHOOL_NOT_ACTIVE', 'SUBSCRIPTION_NO_ACTIVE_STUDENTS'], description: 'The school does not exist or is not ACTIVE, or it has no ACTIVE student.' },
      ],
    },
    {
      method: 'post',
      path: '/schools/:schoolId/students/:studentId',
      operationId: 'createIndividualSubscription',
      summary: 'Create the current month\'s subscription for ONE student',
      description:
        'For a student who joined after the bulk creation. It needs the bulk creation of the current month (Africa/Cairo) to exist for the school (`422 SUBSCRIPTIONS_NOT_CREATED_FOR_MONTH`), the student must be ACTIVE and belong to the school, and a student never gets a second subscription for the same month (`409 SUBSCRIPTION_ALREADY_EXISTS`). The new subscription is UNPAID; no other student is affected. Publishes `SubscriptionCreated`.',
      authorization: managerOrCollector(SubscriptionPermissions.CREATE_INDIVIDUAL, 'The school in the path.'),
      pathParams: { ...schoolIdParam, ...studentIdParam },
      success: { status: 201, description: 'The subscription was created.', data: ref('Subscription'), example: subscriptionExample({ studentName: undefined }) },
      errors: [
        NOT_ALLOWED,
        { status: 404, codes: ['SUBSCRIPTION_STUDENT_NOT_FOUND'], description: 'The student does not exist.' },
        { status: 409, codes: ['SUBSCRIPTION_ALREADY_EXISTS'], description: 'The student already has a subscription for the current month.' },
        { status: 422, codes: ['SUBSCRIPTION_SCHOOL_NOT_ACTIVE', 'SUBSCRIPTIONS_NOT_CREATED_FOR_MONTH', 'SUBSCRIPTION_STUDENT_NOT_IN_SCHOOL', 'SUBSCRIPTION_STUDENT_NOT_ACTIVE'], description: 'The school is not ACTIVE, the month has not been created yet, or the student is not an ACTIVE student of this school.' },
      ],
    },
    {
      method: 'get',
      path: '/schools/:schoolId',
      operationId: 'listSchoolSubscriptions',
      summary: 'List the subscriptions of a school',
      description: 'A paginated list, newest month first by default (`sort=month` or `-month`). Filters: `filter[month]=YYYY-MM`, `filter[status]=UNPAID,PAID`, `filter[studentId]`. A malformed month is `400 INVALID_SUBSCRIPTION_MONTH`.',
      authorization: managerOrCollector(SubscriptionPermissions.LIST, 'The school in the path.'),
      pathParams: schoolIdParam,
      query: listQueryParameters(SUBSCRIPTION_LIST_SPEC),
      success: { status: 200, description: 'A page of subscriptions.', paginated: true, data: ref('Subscription'), example: subscriptionExample() },
      errors: [{ status: 400, codes: ['INVALID_SUBSCRIPTION_MONTH'], description: 'The month filter is not `YYYY-MM`.' }, NOT_ALLOWED],
    },
    {
      method: 'post',
      path: '/schools/:schoolId/collectors',
      operationId: 'registerCollector',
      summary: 'Register (or reuse) a Subscription Collector for a school',
      description:
        'The School Manager registers a Collector of THEIR school with a three-part personal name and a phone number (the same identity rules as Teachers). **New phone:** a new account is created with the name stored on it, the last four digits of the phone as its initial password and the mandatory first-login password change; the SUBSCRIPTION_COLLECTOR role is assigned. **Existing phone:** the account is reused (no duplicate) only when its stored three-part name equals the submitted one; nothing about the account changes and the role is added only if missing. A Collector can be linked to several schools of the SAME organization; an account is never reused across organizations.',
      authorization: managerOnly(SubscriptionPermissions.COLLECTOR_ASSIGN, 'The school in the path (the caller must be its active manager).'),
      pathParams: schoolIdParam,
      request: {
        description: 'The Collector\'s personal name and phone.',
        schema: s.object({ name: s.string({ maxLength: 200, description: 'EXACTLY three parts.', example: 'محمود سعيد علي' }), phone: s.string({ maxLength: 40, example: '01001234569' }) }, ['name', 'phone']),
        examples: { newCollector: { summary: 'Register a Collector', value: { name: 'محمود سعيد علي', phone: '01001234569' } } },
      },
      success: { status: 201, description: 'The Collector was registered (or reused) and linked.', data: ref('CollectorRegistration'), example: { collector: collectorExample, link: linkExample(), accountCreated: true } },
      errors: [
        { status: 400, codes: ['INVALID_COLLECTOR_NAME', 'INVALID_PHONE_NUMBER'], description: 'The name does not have exactly three parts, or the phone is malformed.' },
        NOT_ALLOWED,
        { status: 409, codes: ['COLLECTOR_IDENTITY_CONFLICT', 'COLLECTOR_ORGANIZATION_CONFLICT', 'COLLECTOR_ALREADY_LINKED_TO_SCHOOL', 'COLLECTOR_CONCURRENT_MODIFICATION', 'USER_PHONE_ALREADY_EXISTS'], description: 'The phone belongs to an account that cannot be reused, the Collector is already linked, or a concurrent registration could not be resolved (retry).' },
        { status: 422, codes: ['COLLECTOR_SCHOOL_NOT_ACTIVE', 'COLLECTOR_ACCOUNT_INACTIVE'], description: 'The school is not ACTIVE, or the existing account is deactivated.' },
      ],
    },
    {
      method: 'get',
      path: '/schools/:schoolId/collectors',
      operationId: 'listSchoolCollectors',
      summary: 'List the Collectors currently linked to a school',
      description: 'A paginated list of the Collectors with an ACTIVE link to the school (ended links are history and are not listed).',
      authorization: managerOnly(SubscriptionPermissions.COLLECTOR_LIST, 'The school in the path (the caller must be its active manager).'),
      pathParams: schoolIdParam,
      query: listQueryParameters(COLLECTOR_LIST_SPEC),
      success: { status: 200, description: 'A page of Collectors.', paginated: true, data: ref('Collector'), example: collectorExample },
      errors: [NOT_ALLOWED],
    },
    {
      method: 'delete',
      path: '/schools/:schoolId/collectors/:userId',
      operationId: 'removeCollectorSchoolLink',
      summary: 'End a Collector\'s link to one school',
      description: 'Ends the Collector-to-School relationship for THIS school only. From that moment the Collector has NO access to the school\'s subscriptions. The account, the role and the links to other schools are untouched, and the ended link stays in the history.',
      authorization: managerOnly(SubscriptionPermissions.COLLECTOR_REMOVE, 'The school in the path (the caller must be its active manager).'),
      pathParams: { ...schoolIdParam, userId: { description: 'The Collector\'s account id.', example: USER_ID, schema: s.uuid() } },
      success: { status: 200, description: 'The ended link.', data: ref('CollectorSchoolLink'), example: linkExample({ unlinkedAt: '2026-11-09T08:00:00.000Z', unlinkedBy: USER_ID, isActive: false }) },
      errors: [NOT_ALLOWED, { status: 404, codes: ['COLLECTOR_SCHOOL_LINK_NOT_FOUND'], description: 'The account is not an active Collector of this school.' }, { status: 409, codes: ['COLLECTOR_CONCURRENT_MODIFICATION'], description: 'A concurrent update could not be resolved; retry.' }],
    },
    {
      method: 'get',
      path: '/collectors/me',
      operationId: 'getOwnCollectorProfile',
      summary: 'The caller\'s own Collector profile',
      description: 'A Subscription Collector reads their own profile and the schools they are currently linked to. No id is accepted: the account is the one of the verified token.',
      authorization: { authentication: 'required', roles: ['SUBSCRIPTION_COLLECTOR'], scope: 'The caller\'s own account (derived from the access token).', enforcement: 'Authorization Engine permission (unscoped); the account is the verified user id, never a client-supplied id.', permissionId: SubscriptionPermissions.COLLECTOR_READ_OWN, decision: 'APPROVED', reference: REFERENCE },
      success: { status: 200, description: 'The caller\'s Collector profile.', data: ref('Collector'), example: collectorExample },
      errors: [NOT_ALLOWED, { status: 404, codes: ['COLLECTOR_SCHOOL_LINK_NOT_FOUND'], description: 'The account has never been linked to a school.' }],
    },
    {
      method: 'get',
      path: '/:id',
      operationId: 'getSubscription',
      summary: 'Get one subscription',
      description: 'Returns the subscription to the School Manager of its school or to a Collector currently linked to its school. Any other caller (and an unknown id) is `403 ACCESS_DENIED`.',
      authorization: managerOrCollector(SubscriptionPermissions.READ, 'The subscription\'s school (loaded server-side).'),
      pathParams: subscriptionIdParam,
      success: { status: 200, description: 'The subscription.', data: ref('Subscription'), example: subscriptionExample() },
      errors: [NOT_ALLOWED, { status: 404, codes: ['SUBSCRIPTION_NOT_FOUND'], description: 'The subscription does not exist.' }],
    },
    {
      method: 'post',
      path: '/:id/waive',
      operationId: 'waiveSubscription',
      summary: 'Waive an UNPAID subscription',
      description: 'UNPAID -> WAIVED, by the School Manager of the subscription\'s school ONLY (a Subscription Collector cannot waive in V1). A PAID or already WAIVED subscription is `422 SUBSCRIPTION_NOT_UNPAID`. A waived month no longer blocks newer months (Oldest-Unpaid Rule). Publishes `SubscriptionWaived`.',
      authorization: managerOnly(SubscriptionPermissions.WAIVE, 'The subscription\'s school (loaded server-side; the caller must be its active manager).'),
      pathParams: subscriptionIdParam,
      success: { status: 200, description: 'The waived subscription.', data: ref('Subscription'), example: subscriptionExample({ status: 'WAIVED', waivedAt: '2026-11-09T08:00:00.000Z' }) },
      errors: [
        NOT_ALLOWED,
        { status: 404, codes: ['SUBSCRIPTION_NOT_FOUND'], description: 'The subscription does not exist.' },
        { status: 409, codes: ['SUBSCRIPTION_CONCURRENT_MODIFICATION'], description: 'A concurrent update could not be resolved; retry.' },
        { status: 422, codes: ['SUBSCRIPTION_NOT_UNPAID'], description: 'Only an UNPAID subscription can be waived.' },
      ],
    },
  ],
  schemas: {
    Subscription: subscriptionSchema,
    Collector: collectorSchema,
    CollectorSchoolLink: linkSchema,
    BulkCreationResult: s.object(
      { batchId: s.uuid(), schoolId: s.uuid(), month: s.string({ example: '2026-11' }), count: s.integer({ description: 'How many UNPAID subscriptions were created (one per ACTIVE student).' }), createdAt: s.dateTime() },
      ['batchId', 'schoolId', 'month', 'count', 'createdAt'],
    ),
    CollectorRegistration: s.object(
      { collector: ref('Collector'), link: ref('CollectorSchoolLink'), accountCreated: s.boolean({ description: 'True when a NEW login account was created (initial password + mandatory first-login change); false when an existing account was reused.' }) },
      ['collector', 'link', 'accountCreated'],
    ),
  },
};
