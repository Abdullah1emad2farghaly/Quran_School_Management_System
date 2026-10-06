// Public contract of the Shared Kernel. Other modules import ONLY from here.
export { AppError, ErrorKinds, type ErrorKind, type ErrorMessageParams } from '../domain/errors/app-error';
export { ErrorCodes, type ErrorCode } from '../domain/errors/error-codes';
export type { FieldError } from '../domain/errors/field-error';
export { Entity } from '../domain/entities/entity';
export { AggregateRoot } from '../domain/entities/aggregate-root';
export { ValueObject } from '../domain/value-objects/value-object';
export { type Uuid, isUuid, newUuid, asUuid } from '../domain/value-objects/uuid';
export type { DomainEvent, DomainEventMetadata } from '../domain/events/domain-event';
export { type Clock, SystemClock, FixedClock } from '../domain/contracts/clock';
export type { TransactionContext, UnitOfWork } from '../domain/contracts/unit-of-work';
export { BUSINESS_TIMEZONE, businessDateOf, isIsoDate } from '../domain/services/business-time';
export {
  PAGINATION,
  type SortDirection,
  type PageRequest,
  type PageResult,
  normalizePageRequest,
  pageOffset,
  buildPageResult,
} from '../application/dto/pagination';
