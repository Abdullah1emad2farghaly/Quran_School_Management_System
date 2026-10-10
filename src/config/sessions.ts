import type { RequestHandler } from 'express';
import { SystemClock } from '../modules/00-shared-kernel/public';
import { BcryptPasswordHasher } from '../modules/08-identity-core/public';
import {
  CryptoRefreshTokenGenerator,
  HmacRefreshTokenHasher,
  JwtAccessTokenService,
  SequelizeSessionRepository,
  SessionService,
  createRequireAuthentication,
  createRevokeSessionsOnUserDeactivatedHandler,
} from '../modules/10-sessions-jwt/public';
import { getSequelize, getUnitOfWork } from './database';
import { env } from './env';
import { getIdentityService } from './identity';
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

let handlersRegistered = false;
/** Call once at startup, before startOutbox(). */
export function registerSessionEventHandlers(): void {
  if (handlersRegistered) return;
  handlersRegistered = true;
  getEventHandlerRegistry().register(createRevokeSessionsOnUserDeactivatedHandler(getSessionService()));
}
