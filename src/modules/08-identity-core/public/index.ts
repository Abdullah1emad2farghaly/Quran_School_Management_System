// Public contract of Module 08 (Identity Core): the login identity (phone), password hashing,
// and the ACTIVE/INACTIVE lifecycle. It does not authorize callers and has no HTTP routes.
// Other modules import ONLY from here; the User aggregate and the repository stay private
// to this module's use (the repository port is exported only for composition and tests).
export { IdentityService, type CreateUserInput, type IdentityServiceDeps } from '../application/services/identity-service';
export type { UserDto } from '../application/dto/user-dto';
export type { PasswordHasher } from '../application/ports/password-hasher';
export type { UserRepository } from '../application/ports/user-repository';
export { USER_STATUSES, type UserStatus } from '../domain/value-objects/user-status';
export {
  normalizePhone,
  tryNormalizePhone,
  lastFourDigitsOf,
} from '../domain/value-objects/phone-number';
export {
  PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
  assertPasswordPolicy,
  initialPasswordFromPhone,
} from '../domain/value-objects/password-policy';
export { IdentityErrorCodes, identityError, type IdentityErrorCode } from '../domain/errors/identity-errors';
export {
  IdentityEventTypes,
  USER_AGGREGATE_TYPE,
  type IdentityEventType,
  type UserEventPayload,
} from '../domain/events/user-events';
export { IDENTITY_ERROR_MESSAGES } from '../application/services/identity-error-messages';
export { BcryptPasswordHasher, DEFAULT_BCRYPT_ROUNDS } from '../infrastructure/security/bcrypt-password-hasher';
export { InMemoryUserRepository } from '../infrastructure/services/in-memory-user-repository';
export { SequelizeUserRepository } from '../infrastructure/persistence/sequelize/repositories/sequelize-user-repository';
