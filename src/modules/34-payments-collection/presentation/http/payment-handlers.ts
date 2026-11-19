import type { PageRequest, PageResult } from '../../../00-shared-kernel/public';
import type { PaymentService } from '../../application/services/payment-service';
import type { PaymentStatus } from '../../domain/value-objects/payment-vocabulary';
import { serializePayment } from './payment-serializer';

export type PaymentHandlerService = Pick<PaymentService, 'recordPayment' | 'reversePayment' | 'getPayment' | 'listPaymentsOfSchool'>;

export interface PaymentListRequest {
  readonly schoolId: string;
  readonly month?: string;
  readonly status?: readonly PaymentStatus[];
  readonly studentId?: string;
  readonly subscriptionId?: string;
  readonly direction: 'asc' | 'desc';
  readonly page: PageRequest;
}

/**
 * Framework-free handlers behind the payment routes: they map an already validated request to the application service and the response data.
 * `actorId` always comes from the verified access token (`req.auth.userId`), never from the body. The actor was already authorized by the Authorization Engine.
 */
export function createPaymentHandlers(getPayments: () => PaymentHandlerService) {
  return {
    record: async (subscriptionId: string, actorId: string, method?: unknown) => serializePayment(await getPayments().recordPayment(subscriptionId, actorId, method)),

    reverse: async (paymentId: string, actorId: string, reason: unknown) => serializePayment(await getPayments().reversePayment(paymentId, reason, actorId)),

    get: async (paymentId: string) => serializePayment(await getPayments().getPayment(paymentId)),

    list: async (input: PaymentListRequest): Promise<PageResult<ReturnType<typeof serializePayment>>> => {
      const page = await getPayments().listPaymentsOfSchool({
        schoolId: input.schoolId,
        ...(input.month !== undefined ? { month: input.month } : {}),
        ...(input.status ? { status: input.status } : {}),
        ...(input.studentId ? { studentId: input.studentId } : {}),
        ...(input.subscriptionId ? { subscriptionId: input.subscriptionId } : {}),
        direction: input.direction,
        page: input.page,
      });
      return { ...page, items: page.items.map(serializePayment) };
    },
  };
}
