// Public contract of Module 33 (Subscriptions): the Subscription (Student + Month + Status: PAID / UNPAID / WAIVED), the monthly bulk creation (current Africa/Cairo month),
// individual creation for late joiners, waiving (School Manager), the Oldest-Unpaid Rule (Master Specification §59) behind the `markPaid` application contract that Module 34
// (Payments) calls (never an HTTP operation), and the Subscription Collector-to-School assignment with history (Teacher-link conventions).
// Other modules depend on `SubscriptionLookup` / `CollectorDirectory` (read-only) and, for payments only, `SubscriptionPayments`. Permissions are registered through the Module 12 engine.
export { SubscriptionService, type SubscriptionLookup, type SubscriptionPayments, type SubscriptionServiceDeps, type ListSubscriptionsInput } from '../application/services/subscription-service';
export { SubscriptionGroupService, type SubscriptionGroupServiceDeps } from '../application/services/subscription-group-service';
export { CollectorService, type CollectorDirectory, type CollectorServiceDeps, type RegisterCollectorInput, type CollectorRegistrationResult } from '../application/services/collector-service';
export { SubscriptionPermissions, SUBSCRIPTION_SCHOOL_TARGET_TYPE, SUBSCRIPTION_TARGET_TYPE, registerSubscriptionAuthorization, type SubscriptionAuthorizationDeps } from '../application/services/subscription-authorization';
export { SUBSCRIPTION_ERROR_MESSAGES } from '../application/services/subscription-error-messages';
export type { GroupSubscriptionSummaryDto, GroupStudentSubscriptionDto } from '../application/dto/subscription-dto';
export type { SubscriptionDto, SubscriptionViewDto, SubscriptionScopeDto, SubscriptionBatchDto, BulkCreationResultDto, CollectorDto, CollectorSchoolLinkDto } from '../application/dto/subscription-dto';
export type { SubscriptionRepository, SubscriptionListQuery } from '../application/ports/subscription-repository';
export type { CollectorLinkRepository } from '../application/ports/collector-link-repository';
export type { StudentRoster, RosterStudent } from '../application/ports/student-roster';
export type { SchoolGroupRoster, RosterGroup, RosterGroupStudent } from '../application/ports/school-group-roster';
export { Subscription, type SubscriptionSnapshot } from '../domain/entities/subscription';
export { SubscriptionBatch, type SubscriptionBatchSnapshot } from '../domain/entities/subscription-batch';
export { CollectorSchoolLink, type CollectorSchoolLinkSnapshot } from '../domain/entities/collector-school-link';
export { SubscriptionErrorCodes, subscriptionError, type SubscriptionErrorCode } from '../domain/errors/subscription-errors';
export {
  SubscriptionEventTypes,
  SUBSCRIPTION_AGGREGATE_TYPE,
  SUBSCRIPTION_BATCH_AGGREGATE_TYPE,
  COLLECTOR_SCHOOL_LINK_AGGREGATE_TYPE,
  type SubscriptionEventType,
  type SubscriptionEventPayload,
  type SubscriptionBatchEventPayload,
  type CollectorSchoolLinkEventPayload,
} from '../domain/events/subscription-events';
export { SUBSCRIPTION_STATUSES, isSubscriptionStatus, isSettled, type SubscriptionStatus } from '../domain/value-objects/subscription-status';
export { BILLING_MONTH_PATTERN, isBillingMonth, currentBillingMonth } from '../domain/value-objects/billing-month';
export { InMemorySubscriptionRepository, InMemoryCollectorLinkRepository } from '../infrastructure/services/in-memory-subscription-repositories';
export { PublicStudentRoster } from '../infrastructure/services/public-student-roster';
export { PublicSchoolGroupRoster } from '../infrastructure/services/public-school-group-roster';
export { SequelizeSubscriptionRepository } from '../infrastructure/persistence/sequelize/repositories/sequelize-subscription-repository';
export { SequelizeCollectorLinkRepository } from '../infrastructure/persistence/sequelize/repositories/sequelize-collector-link-repository';
export { createSubscriptionRouter, SUBSCRIPTION_LIST_SPEC, GROUP_LIST_SPEC, COLLECTOR_LIST_SPEC, type SubscriptionRouterDeps } from '../presentation/http/subscription-routes';
export { subscriptionApiDoc } from '../presentation/http/subscription.openapi';
