// Public contract of Module 34 (Payments & Collection), Master Specification §60-§61: the cash Payment of a subscription (CASH ONLY, no amount, one SUCCESSFUL payment per subscription,
// never hard-deleted) and its REVERSAL (mandatory reason, actor, time; audited). Recording and reversing change the subscription ONLY through Module 33's controlled `applyPaymentRecorded` / `applyPaymentReversed`
// contracts, in one transaction (the Oldest-Unpaid Rule §59 lives there). Other modules depend on `PaymentLookup` (read-only). Permissions are registered through the Module 12 engine.
export { PaymentService, type PaymentLookup, type PaymentServiceDeps, type ListPaymentsInput } from '../application/services/payment-service';
export { PaymentPermissions, PAYMENT_TARGET_TYPE, registerPaymentAuthorization, type PaymentAuthorizationDeps } from '../application/services/payment-authorization';
export { PAYMENT_ERROR_MESSAGES } from '../application/services/payment-error-messages';
export type { PaymentDto, PaymentScopeDto } from '../application/dto/payment-dto';
export type { PaymentRepository, PaymentListQuery, PaymentStatusCount, PaymentStatusCountQuery } from '../application/ports/payment-repository';
export { Payment, type PaymentSnapshot } from '../domain/entities/payment';
export { PaymentErrorCodes, paymentError, type PaymentErrorCode } from '../domain/errors/payment-errors';
export { PaymentEventTypes, PAYMENT_AGGREGATE_TYPE, type PaymentEventType, type PaymentRecordedPayload, type PaymentReversedPayload } from '../domain/events/payment-events';
export { PAYMENT_METHODS, PAYMENT_STATUSES, REVERSAL_REASON_MAX_LENGTH, isPaymentMethod, type PaymentMethod, type PaymentStatus } from '../domain/value-objects/payment-vocabulary';
export { InMemoryPaymentRepository } from '../infrastructure/services/in-memory-payment-repository';
export { SequelizePaymentRepository } from '../infrastructure/persistence/sequelize/repositories/sequelize-payment-repository';
export { createPaymentRouter, PAYMENT_LIST_SPEC, type PaymentRouterDeps } from '../presentation/http/payment-routes';
export { paymentApiDoc } from '../presentation/http/payment.openapi';
