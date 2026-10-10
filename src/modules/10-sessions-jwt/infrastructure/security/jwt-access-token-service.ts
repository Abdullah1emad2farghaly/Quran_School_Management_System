import jwt from 'jsonwebtoken';
import type { AccessTokenClaims, AccessTokenService, AccessTokenVerification } from '../../application/ports/token-ports';
import { ACCESS_TOKEN_TTL_SECONDS } from '../../domain/value-objects/token-policy';

const ISSUER = 'qsms';
const ALGORITHM = 'HS256';

/**
 * HS256 access token (15 minutes). Claims: `sub` (user id), `sid` (session id), `iat`, `exp`, `iss`.
 * Roles are deliberately NOT in the token: they can change, and authorization always reads them from the backend.
 * Verification pins the algorithm (so "alg: none" and algorithm-confusion tokens are rejected) and the issuer.
 */
export class JwtAccessTokenService implements AccessTokenService {
  constructor(private readonly secret: string) {
    if (!secret) throw new Error('JWT_ACCESS_SECRET is not configured');
  }

  sign(claims: AccessTokenClaims, now: Date): { token: string; expiresAt: Date } {
    const iat = Math.floor(now.getTime() / 1000);
    const exp = iat + ACCESS_TOKEN_TTL_SECONDS;
    const token = jwt.sign({ sub: claims.userId, sid: claims.sessionId, iat, exp, iss: ISSUER }, this.secret, {
      algorithm: ALGORITHM,
    });
    return { token, expiresAt: new Date(exp * 1000) };
  }

  verify(token: string, now: Date): AccessTokenVerification {
    try {
      const payload = jwt.verify(token, this.secret, {
        algorithms: [ALGORITHM],
        issuer: ISSUER,
        clockTimestamp: Math.floor(now.getTime() / 1000),
      });
      if (typeof payload === 'string') return { ok: false, reason: 'invalid' };
      const { sub, sid } = payload as { sub?: unknown; sid?: unknown };
      if (typeof sub !== 'string' || typeof sid !== 'string' || sub === '' || sid === '') return { ok: false, reason: 'invalid' };
      return { ok: true, claims: { userId: sub, sessionId: sid } };
    } catch (error) {
      return { ok: false, reason: error instanceof jwt.TokenExpiredError ? 'expired' : 'invalid' };
    }
  }
}
