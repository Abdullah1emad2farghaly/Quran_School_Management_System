import jwt from 'jsonwebtoken';
import { describe, expect, it } from 'vitest';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  CryptoRefreshTokenGenerator,
  HmacRefreshTokenHasher,
  JwtAccessTokenService,
  REFRESH_TOKEN_TTL_SECONDS,
} from '../../../src/modules/10-sessions-jwt/public';
import { ACCESS_SECRET, REFRESH_SECRET } from '../../helpers/session-harness';

const NOW = new Date('2026-10-09T10:00:00Z');
const claims = { userId: '11111111-1111-4111-8111-111111111111', sessionId: '22222222-2222-4222-8222-222222222222' };
const jwtService = new JwtAccessTokenService(ACCESS_SECRET);

describe('approved token lifetimes (§25)', () => {
  it('access token is 15 minutes and refresh token is 30 days', () => {
    expect(ACCESS_TOKEN_TTL_SECONDS).toBe(900);
    expect(REFRESH_TOKEN_TTL_SECONDS).toBe(30 * 24 * 3600);
  });
});

describe('JwtAccessTokenService', () => {
  it('signs a token that verifies back to the same claims', () => {
    const { token } = jwtService.sign(claims, NOW);
    expect(jwtService.verify(token, NOW)).toEqual({ ok: true, claims });
  });

  it('expires exactly 15 minutes after issue', () => {
    const { token, expiresAt } = jwtService.sign(claims, NOW);
    expect(expiresAt).toEqual(new Date('2026-10-09T10:15:00Z'));
    expect(jwtService.verify(token, new Date(NOW.getTime() + 899_000)).ok).toBe(true);
    expect(jwtService.verify(token, new Date(NOW.getTime() + 900_000))).toEqual({ ok: false, reason: 'expired' });
  });

  it('carries only sub, sid, iat, exp and iss (no roles, no phone)', () => {
    const payload = jwt.decode(jwtService.sign(claims, NOW).token) as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(['exp', 'iat', 'iss', 'sid', 'sub']);
    expect(payload.exp).toBe((payload.iat as number) + 900);
  });

  it('rejects tampering, other secrets, the refresh secret, and garbage', () => {
    const { token } = jwtService.sign(claims, NOW);
    const [h, p, s] = token.split('.');
    const forgedPayload = Buffer.from(JSON.stringify({ sub: 'attacker', sid: claims.sessionId, iss: 'qsms', iat: 1, exp: 9999999999 })).toString('base64url');
    const wrongSecret = jwt.sign({ sub: claims.userId, sid: claims.sessionId, iss: 'qsms' }, 'another-secret-another-secret-xx', { expiresIn: 60 });
    const withRefreshSecret = jwt.sign({ sub: claims.userId, sid: claims.sessionId, iss: 'qsms' }, REFRESH_SECRET, { expiresIn: 60 });
    for (const bad of [`${h}.${forgedPayload}.${s}`, `${h}.${p}.`, wrongSecret, withRefreshSecret, '', 'abc', 'a.b.c']) {
      expect(jwtService.verify(bad, NOW), bad).toEqual({ ok: false, reason: 'invalid' });
    }
  });

  it('rejects alg=none and algorithm-confusion tokens', () => {
    const none = jwt.sign({ sub: claims.userId, sid: claims.sessionId, iss: 'qsms' }, '', { algorithm: 'none' });
    const hs512 = jwt.sign({ sub: claims.userId, sid: claims.sessionId, iss: 'qsms' }, ACCESS_SECRET, { algorithm: 'HS512', expiresIn: 60 });
    expect(jwtService.verify(none, NOW).ok).toBe(false);
    expect(jwtService.verify(hs512, NOW).ok).toBe(false);
  });

  it('rejects the wrong issuer and missing claims', () => {
    const exp = Math.floor(NOW.getTime() / 1000) + 60;
    const sign = (payload: object) => jwt.sign({ exp, ...payload }, ACCESS_SECRET);
    expect(jwtService.verify(sign({ sub: claims.userId, sid: claims.sessionId, iss: 'someone-else' }), NOW).ok).toBe(false);
    expect(jwtService.verify(sign({ sub: claims.userId, iss: 'qsms' }), NOW).ok).toBe(false);
    expect(jwtService.verify(sign({ sid: claims.sessionId, iss: 'qsms' }), NOW).ok).toBe(false);
  });

  it('refuses to start without a secret', () => {
    expect(() => new JwtAccessTokenService('')).toThrow();
  });
});

describe('refresh token crypto', () => {
  const hasher = new HmacRefreshTokenHasher(REFRESH_SECRET);
  const generator = new CryptoRefreshTokenGenerator();

  it('generates unique, long, URL-safe tokens', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => generator.generate()));
    expect(tokens.size).toBe(200);
    for (const t of tokens) expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/); // 256 bits
  });

  it('hashes deterministically, with a keyed hash that does not contain the token', () => {
    const token = generator.generate();
    const hash = hasher.hash(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hasher.hash(token)).toBe(hash);
    expect(hash).not.toContain(token);
    expect(hasher.hash(generator.generate())).not.toBe(hash);
  });

  it('depends on the secret (a leaked database alone cannot be used to check guesses)', () => {
    const token = generator.generate();
    expect(new HmacRefreshTokenHasher('a-different-secret-a-different-secret').hash(token)).not.toBe(hasher.hash(token));
  });

  it('refuses to start without a secret', () => {
    expect(() => new HmacRefreshTokenHasher('')).toThrow();
  });
});
