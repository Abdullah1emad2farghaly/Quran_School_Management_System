// Public contract of Module 10 (Sessions & JWT): authentication only (login, refresh with rotation, logout,
// access-token verification). Authorization (roles, permissions, scope, ownership) is Module 12.
// Other modules' routes use `createRequireAuthentication` to protect endpoints and read `req.auth`.
export { SessionService, type SessionServiceDeps } from '../application/services/session-service';
export type { AuthResult, AuthPrincipal } from '../application/dto/auth-result';
export type { SessionRepository } from '../application/ports/session-repository';
export type {
  AccessTokenService,
  AccessTokenClaims,
  AccessTokenVerification,
  RefreshTokenHasher,
  RefreshTokenGenerator,
} from '../application/ports/token-ports';
export { ACCESS_TOKEN_TTL_SECONDS, REFRESH_TOKEN_TTL_SECONDS } from '../domain/value-objects/token-policy';
export { SESSION_REVOKE_REASONS, type SessionRevokeReason } from '../domain/value-objects/session-revoke-reason';
export { SessionErrorCodes, sessionError, type SessionErrorCode } from '../domain/errors/session-errors';
export {
  SessionEventTypes,
  AUTH_SESSION_AGGREGATE_TYPE,
  type SessionEventType,
  type AuthSessionEventPayload,
} from '../domain/events/session-events';
export { SESSION_ERROR_MESSAGES } from '../application/services/session-error-messages';
export { createRevokeSessionsOnUserDeactivatedHandler } from '../application/handlers/revoke-sessions-on-user-deactivated';
export { JwtAccessTokenService } from '../infrastructure/security/jwt-access-token-service';
export { HmacRefreshTokenHasher, CryptoRefreshTokenGenerator } from '../infrastructure/security/refresh-token-crypto';
export { InMemorySessionRepository } from '../infrastructure/services/in-memory-session-repository';
export { SequelizeSessionRepository } from '../infrastructure/persistence/sequelize/repositories/sequelize-session-repository';
export { createRequireAuthentication } from '../presentation/http/authentication.middleware';
export { createAuthRouter, type AuthRouterDeps } from '../presentation/http/auth.routes';
