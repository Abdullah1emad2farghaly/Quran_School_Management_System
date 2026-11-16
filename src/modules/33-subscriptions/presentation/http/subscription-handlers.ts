import type { PageRequest, PageResult } from '../../../00-shared-kernel/public';
import type { CollectorService } from '../../application/services/collector-service';
import type { SubscriptionGroupService } from '../../application/services/subscription-group-service';
import type { SubscriptionService } from '../../application/services/subscription-service';
import type { SubscriptionStatus } from '../../domain/value-objects/subscription-status';
import { serializeBulkResult, serializeCollector, serializeCollectorLink, serializeGroupStudent, serializeGroupSummary, serializeSubscription } from './subscription-serializer';

export type SubscriptionHandlerService = Pick<SubscriptionService, 'createMonthlySubscriptions' | 'createIndividualSubscription' | 'listSubscriptionsOfSchool' | 'getSubscription' | 'waiveSubscription' | 'markPaid' | 'markUnpaid'>;
export type GroupHandlerService = Pick<SubscriptionGroupService, 'listGroupSummaries' | 'listGroupStudents'>;
export type CollectorHandlerService = Pick<CollectorService, 'registerCollector' | 'listCollectorsOfSchool' | 'removeSchoolLink' | 'getOwnProfile'>;

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const obj = (value: unknown): Json => (typeof value === 'object' && value !== null ? (value as Json) : {});

export interface SubscriptionListRequest {
  readonly schoolId: string;
  readonly month?: string;
  readonly status?: readonly SubscriptionStatus[];
  readonly studentId?: string;
  readonly direction: 'asc' | 'desc';
  readonly page: PageRequest;
}

/**
 * Framework-free handlers behind the subscription routes: they map an already validated request to the application services and the response data.
 * `actorId` / `userId` always come from the verified access token (`req.auth.userId`), never from the body. The actor was already authorized by the Authorization Engine.
 */
export function createSubscriptionHandlers(getSubscriptions: () => SubscriptionHandlerService, getCollectors: () => CollectorHandlerService, getGroups: () => GroupHandlerService) {
  return {
    createMonthly: async (schoolId: string, actorId: string) => serializeBulkResult(await getSubscriptions().createMonthlySubscriptions(schoolId, actorId)),

    createIndividual: async (schoolId: string, studentId: string, actorId: string) => serializeSubscription(await getSubscriptions().createIndividualSubscription(schoolId, studentId, actorId)),

    list: async (input: SubscriptionListRequest): Promise<PageResult<ReturnType<typeof serializeSubscription>>> => {
      const page = await getSubscriptions().listSubscriptionsOfSchool({
        schoolId: input.schoolId,
        ...(input.month !== undefined ? { month: input.month } : {}),
        ...(input.status ? { status: input.status } : {}),
        ...(input.studentId ? { studentId: input.studentId } : {}),
        direction: input.direction,
        page: input.page,
      });
      return { ...page, items: page.items.map(serializeSubscription) };
    },

    get: async (subscriptionId: string) => serializeSubscription(await getSubscriptions().getSubscription(subscriptionId)),

    waive: async (subscriptionId: string, actorId: string) => serializeSubscription(await getSubscriptions().waiveSubscription(subscriptionId, actorId)),

    /** UNPAID -> PAID through the `markPaid` contract (Oldest-Unpaid Rule §59 is enforced there). */
    markPaid: async (subscriptionId: string, actorId: string) => serializeSubscription(await getSubscriptions().markPaid(subscriptionId, actorId)),

    /** PAID -> UNPAID, current Africa/Cairo month only (see `SubscriptionService.markUnpaid`). */
    markUnpaid: async (subscriptionId: string, actorId: string) => serializeSubscription(await getSubscriptions().markUnpaid(subscriptionId, actorId)),

    listGroups: async (schoolId: string, month: string | undefined, direction: 'asc' | 'desc', page: PageRequest) => {
      const result = await getGroups().listGroupSummaries(schoolId, { ...(month !== undefined ? { month } : {}), direction, page });
      return { ...result, items: result.items.map(serializeGroupSummary) };
    },

    listGroupStudents: async (schoolId: string, groupId: string, month: string | undefined, direction: 'asc' | 'desc', page: PageRequest) => {
      const result = await getGroups().listGroupStudents(schoolId, groupId, { ...(month !== undefined ? { month } : {}), direction, page });
      return { ...result, items: result.items.map(serializeGroupStudent) };
    },

    registerCollector: async (schoolId: string, body: unknown, actorId: string) => {
      const b = obj(body);
      const result = await getCollectors().registerCollector({ schoolId, name: b.name, phone: b.phone }, actorId);
      return { collector: serializeCollector(result.collector), link: serializeCollectorLink(result.link), accountCreated: result.accountCreated };
    },

    listCollectors: async (schoolId: string, page: PageRequest) => {
      const result = await getCollectors().listCollectorsOfSchool(schoolId, page);
      return { ...result, items: result.items.map(serializeCollector) };
    },

    removeCollector: async (userId: string, schoolId: string, actorId: string) => serializeCollectorLink(await getCollectors().removeSchoolLink(userId, schoolId, actorId)),

    getOwnCollectorProfile: async (userId: string) => serializeCollector(await getCollectors().getOwnProfile(userId)),
  };
}
