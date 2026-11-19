import { listQueryParameters, ref, schema as s, type AuthorizationDoc, type ErrorDoc, type ModuleApiDoc } from '../../../04-validation-api/public';
import { PaymentPermissions } from '../../application/services/payment-authorization';
import { PAYMENT_LIST_SPEC } from './payment-routes';

const PAYMENT_ID = 'c4a8e1d3-5b27-4f90-8a16-3d7e9b2f6c58';
const SUBSCRIPTION_ID = '5d1c8e07-3a92-4b64-9f10-7e2a6c4b8d13';
const STUDENT_ID = '8b3e5f19-4c70-4d26-a1e8-2f9d6b0c7a45';
const USER_ID = '3f6b1d52-8a4e-4c1b-9d77-2b6f0c9a1e10';
const SCHOOL_ID = '9a4e7c21-6d03-4b58-8e1f-0c2d5b7a3f64';

const REFERENCE = 'docs/AUTHORIZATION-MATRIX.md (Payments 34); docs/PAYMENTS.md';
const BOTH_ENFORCEMENT =
  'Enforced by the Authorization Engine (deny by default): the caller must hold the SCHOOL_MANAGER role AND an active manager link to the school, OR the SUBSCRIPTION_COLLECTOR role AND a CURRENTLY ACTIVE collector link to the school (an ended link grants nothing). For a subscription or a payment the school is loaded server-side. ORGANIZATION_MANAGER, MAIN_ADMIN, PARENT, TEACHER and STUDENT have no payment permission.';
const managerOrCollector = (permissionId: string, scope: string): AuthorizationDoc => ({ authentication: 'required', roles: ['SCHOOL_MANAGER', 'SUBSCRIPTION_COLLECTOR'], scope, enforcement: BOTH_ENFORCEMENT, permissionId, decision: 'APPROVED', reference: REFERENCE });

const NOT_ALLOWED: ErrorDoc = { status: 403, codes: ['ACCESS_DENIED', 'PASSWORD_CHANGE_REQUIRED'], description: 'The caller lacks the permission or the scope (no reason is given; the existence of a subscription or payment is never revealed), or the account must first change its initial password.' };

const paymentSchema = s.object(
  {
    id: s.uuid(),
    subscriptionId: s.uuid(),
    studentId: s.uuid(),
    schoolId: s.uuid(),
    month: s.string({ pattern: '^\\d{4}-(0[1-9]|1[0-2])$', description: 'The month `YYYY-MM` (Africa/Cairo) of the paid subscription.', example: '2026-11' }),
    method: s.string({ enum: ['CASH'], description: 'CASH is the only payment method in V1.' }),
    status: s.string({ enum: ['SUCCESSFUL', 'REVERSED'], description: 'SUCCESSFUL until reversed. A reversed payment stays as history; a payment is never deleted. There is no amount: it is determined outside the system.' }),
    recordedBy: s.uuid(),
    recordedAt: s.dateTime(),
    reversedBy: s.uuid({ nullable: true }),
    reversedAt: s.dateTime({ nullable: true }),
    reversalReason: s.string({ nullable: true, description: 'The mandatory reason of the reversal (1 to 500 characters).' }),
    updatedAt: s.dateTime(),
  },
  ['id', 'subscriptionId', 'studentId', 'schoolId', 'month', 'method', 'status', 'recordedBy', 'recordedAt', 'reversedBy', 'reversedAt', 'reversalReason', 'updatedAt'],
);

const paymentExample = (o: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: PAYMENT_ID, subscriptionId: SUBSCRIPTION_ID, studentId: STUDENT_ID, schoolId: SCHOOL_ID, month: '2026-11', method: 'CASH', status: 'SUCCESSFUL', recordedBy: USER_ID,
  recordedAt: '2026-11-17T09:00:00.000Z', reversedBy: null, reversedAt: null, reversalReason: null, updatedAt: '2026-11-17T09:00:00.000Z', ...o,
});

const schoolIdParam = { schoolId: { description: 'The school id.', example: SCHOOL_ID, schema: s.uuid() } };
const subscriptionIdParam = { subscriptionId: { description: 'The subscription id.', example: SUBSCRIPTION_ID, schema: s.uuid() } };
const paymentIdParam = { id: { description: 'The payment id.', example: PAYMENT_ID, schema: s.uuid() } };

/** OpenAPI contract of `/payments` (`payment-routes.ts`). Module 34: payments & collection. */
export const paymentApiDoc: ModuleApiDoc = {
  moduleId: '34',
  mountPath: '/payments',
  tag: {
    name: 'Payments',
    description:
      'Cash payments of subscriptions (Master Specification §60-§61): CASH ONLY, no amount, one SUCCESSFUL payment per subscription, never hard-deleted, and a reversal that needs a reason, the actor and the time and is audited. Recording and reversing go through Module 33\'s `markPaid` / `reversePaid` contracts in ONE transaction, so the Oldest-Unpaid Rule (§59) is always enforced. Collection is done by the School Manager or the school\'s Subscription Collector.',
  },
  operations: [
    {
      method: 'post',
      path: '/subscriptions/:subscriptionId',
      operationId: 'recordPayment',
      summary: 'Record the cash payment of a subscription',
      description:
        'The School Manager or the school\'s Collector records that the subscription was paid in cash. In ONE transaction the subscription goes UNPAID -> PAID (Module 33 `applyPaymentRecorded`, the only way a subscription becomes PAID: the Oldest-Unpaid Rule §59 applies, and the Parent (only) is notified through the `PaymentRecorded` event) and a SUCCESSFUL payment row (Student + School + Subscription, CASH, actor, time) is stored. The body is optional; if `method` is sent it must be `CASH`. No amount is accepted or stored. A subscription that is already PAID, WAIVED, or has an older unpaid month is refused and nothing changes.',
      authorization: managerOrCollector(PaymentPermissions.RECORD, 'The subscription\'s school (loaded server-side).'),
      pathParams: subscriptionIdParam,
      request: {
        description: 'Optional. `method`, when present, must be `CASH`.',
        schema: s.object({ method: s.string({ enum: ['CASH'], description: 'Only CASH is allowed.', example: 'CASH' }) }, []),
        examples: { cash: { summary: 'Cash payment', value: { method: 'CASH' } } },
      },
      success: { status: 201, description: 'The payment was recorded and the subscription is now PAID.', data: ref('Payment'), example: paymentExample() },
      errors: [
        { status: 400, codes: ['PAYMENT_METHOD_NOT_ALLOWED'], description: 'A payment method other than CASH was sent.' },
        NOT_ALLOWED,
        { status: 409, codes: ['SUBSCRIPTION_ALREADY_PAID', 'PAYMENT_ALREADY_RECORDED', 'SUBSCRIPTION_CONCURRENT_MODIFICATION', 'PAYMENT_CONCURRENT_MODIFICATION'], description: 'The subscription is already PAID (one successful payment per subscription), or a concurrent change could not be resolved; retry.' },
        { status: 422, codes: ['SUBSCRIPTION_NOT_UNPAID', 'OLDER_UNPAID_SUBSCRIPTIONS_EXIST'], description: 'The subscription is WAIVED, or an older month of the student is neither PAID nor WAIVED (§59).' },
      ],
    },
    {
      method: 'get',
      path: '/schools/:schoolId',
      operationId: 'listPayments',
      summary: 'List the payments of a school',
      description: 'A paginated list, newest first by default (`sort=recordedAt` or `-recordedAt`). Filters: `filter[month]=YYYY-MM`, `filter[status]=SUCCESSFUL,REVERSED`, `filter[studentId]`, `filter[subscriptionId]`. A malformed month is `400 INVALID_PAYMENT_MONTH`. Reversed payments are included (they are history).',
      authorization: managerOrCollector(PaymentPermissions.LIST, 'The school in the path.'),
      pathParams: schoolIdParam,
      query: listQueryParameters(PAYMENT_LIST_SPEC),
      success: { status: 200, description: 'A page of payments.', paginated: true, data: ref('Payment'), example: paymentExample() },
      errors: [{ status: 400, codes: ['INVALID_PAYMENT_MONTH'], description: 'A malformed month.' }, NOT_ALLOWED],
    },
    {
      method: 'get',
      path: '/:id',
      operationId: 'getPayment',
      summary: 'Read one payment',
      description: 'One payment of a school the caller manages or is currently linked to. A payment of another school is `403` (its existence is never revealed).',
      authorization: managerOrCollector(PaymentPermissions.READ, 'The payment\'s school (loaded server-side).'),
      pathParams: paymentIdParam,
      success: { status: 200, description: 'The payment.', data: ref('Payment'), example: paymentExample() },
      errors: [NOT_ALLOWED],
    },
    {
      method: 'post',
      path: '/:id/reverse',
      operationId: 'reversePayment',
      summary: 'Reverse a payment (reason required)',
      description:
        'Reverses a SUCCESSFUL payment with a mandatory reason (1 to 500 characters after trimming). The reason, the actor and the time are stored on the payment, which is KEPT (never deleted) and audited (`PaymentReversed`). In the same transaction the subscription goes PAID -> UNPAID (Module 33\'s controlled `applyPaymentReversed`); that is refused while a NEWER month of the student is PAID, so the Oldest-Unpaid Rule is never broken. A reversal happens once; afterwards the subscription can be paid again by a NEW payment. Allowed for the School Manager and the Subscription Collector of the payment\'s school (owner decision 2026-11-17); no other role. Only a payment that was actually recorded can be reversed.',
      authorization: managerOrCollector(PaymentPermissions.REVERSE, 'The payment\'s school (loaded server-side).'),
      pathParams: paymentIdParam,
      request: {
        description: 'The reason for the reversal (required, not empty, at most 500 characters).',
        schema: s.object({ reason: s.string({ description: 'Why the payment is reversed.', example: 'تم تسجيل الدفعة بالخطأ' }) }, ['reason']),
        examples: { mistake: { summary: 'Recorded by mistake', value: { reason: 'تم تسجيل الدفعة بالخطأ' } } },
      },
      success: { status: 200, description: 'The reversed payment.', data: ref('Payment'), example: paymentExample({ status: 'REVERSED', reversedBy: USER_ID, reversedAt: '2026-11-17T10:00:00.000Z', reversalReason: 'تم تسجيل الدفعة بالخطأ', updatedAt: '2026-11-17T10:00:00.000Z' }) },
      errors: [
        { status: 400, codes: ['PAYMENT_REVERSAL_REASON_REQUIRED', 'PAYMENT_REVERSAL_REASON_TOO_LONG'], description: 'The reason is empty (or only blanks) or longer than 500 characters.' },
        NOT_ALLOWED,
        { status: 409, codes: ['PAYMENT_ALREADY_REVERSED', 'SUBSCRIPTION_CONCURRENT_MODIFICATION', 'PAYMENT_CONCURRENT_MODIFICATION'], description: 'The payment was already reversed (nothing changes), or a concurrent change could not be resolved; retry.' },
        { status: 422, codes: ['SUBSCRIPTION_NOT_PAID', 'NEWER_PAID_SUBSCRIPTIONS_EXIST'], description: 'The subscription is WAIVED, or a newer month of the student is PAID (§59).' },
      ],
    },
  ],
  schemas: { Payment: paymentSchema },
};
