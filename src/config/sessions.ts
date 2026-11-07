import type { RequestHandler } from 'express';
import { SystemClock } from '../modules/00-shared-kernel/public';
import { BcryptPasswordHasher } from '../modules/08-identity-core/public';
import {
  CryptoRefreshTokenGenerator,
  HmacRefreshTokenHasher,
  JwtAccessTokenService,
  SequelizeSessionRepository,
  SessionExpiryScheduler,
  SessionService,
  createRequireAuthentication,
  createRevokeSessionsOnUserDeactivatedHandler,
} from '../modules/10-sessions-jwt/public';
import { getSequelize, getUnitOfWork } from './database';
import { env } from './env';
import { getIdentityService } from './identity';
import { logger } from './logger';
import { getEventHandlerRegistry, getOutboxService } from './outbox';
import { getRoleService } from './roles';

let service: SessionService | undefined;

/** Inject into other modules (never construct SessionService elsewhere). Needs JWT_ACCESS_SECRET and JWT_REFRESH_SECRET. */
export function getSessionService(): SessionService {
  if (!service) {
    const { accessSecret, refreshSecret } = env.jwt;
    if (!accessSecret || !refreshSecret) throw new Error('JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be set');
    if (accessSecret === refreshSecret) throw new Error('JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different');
    service = new SessionService({
      repository: new SequelizeSessionRepository(getSequelize()),
      identity: getIdentityService(),
      roles: getRoleService(),
      accessTokens: new JwtAccessTokenService(accessSecret),
      refreshTokenHasher: new HmacRefreshTokenHasher(refreshSecret),
      refreshTokenGenerator: new CryptoRefreshTokenGenerator(),
      passwordHasher: new BcryptPasswordHasher(),
      unitOfWork: getUnitOfWork(),
      outbox: getOutboxService(),
      clock: new SystemClock(),
    });
  }
  return service;
}

/** Protects a route: authenticated caller required (`req.auth`). Authorization is a separate step (Module 12). */
export const requireAuthentication: RequestHandler = createRequireAuthentication(getSessionService);

/**
 * Same, but ALSO accepted while the account must still change its initial password. ONLY for the password change and the logouts
 * (`/auth/change-password`, `/auth/logout`, `/auth/logout-all`); every other protected route uses `requireAuthentication`, which answers
 * 403 PASSWORD_CHANGE_REQUIRED until the password was changed.
 */
export const requireAuthenticationAllowingPasswordChange: RequestHandler = createRequireAuthentication(getSessionService, { allowPasswordChangePending: true });

let handlersRegistered = false;
/** Call once at startup, before startOutbox(). */
export function registerSessionEventHandlers(): void {
  if (handlersRegistered) return;
  handlersRegistered = true;
  getEventHandlerRegistry().register(createRevokeSessionsOnUserDeactivatedHandler(getSessionService()));
}

let expiryScheduler: SessionExpiryScheduler | undefined;

/**
 * Starts the periodic cleanup of expired sessions (polls every 5 minutes; no Redis needed): a session whose 30-day refresh token expired is revoked
 * with SESSION_EXPIRED and AuthSessionRevoked, which frees its slot and lets dependent modules clean up. Idempotent; call once at startup.
 */
export function startSessionExpiryScheduler(): void {
  if (expiryScheduler) return;
  expiryScheduler = new SessionExpiryScheduler({
    job: getSessionService(),
    onError: (error) => logger.error('session expiry pass failed', { error: String(error) }),
    onResult: (result) => logger.info('expired sessions revoked', { expired: result.expired, failed: result.failed }),
  });
  expiryScheduler.start();
}

export function stopSessionExpiryScheduler(): void {
  expiryScheduler?.stop();
  expiryScheduler = undefined;
}
