export interface AccessTokenClaims {
  readonly userId: string;
  readonly sessionId: string;
}

export type AccessTokenVerification =
  | { readonly ok: true; readonly claims: AccessTokenClaims }
  | { readonly ok: false; readonly reason: 'expired' | 'invalid' };

/** Signs/verifies the short-lived (15 min) access token. */
export interface AccessTokenService {
  sign(claims: AccessTokenClaims, now: Date): { token: string; expiresAt: Date };
  verify(token: string, now: Date): AccessTokenVerification;
}

/** One-way (keyed) hash of a refresh token; only the hash is persisted. */
export interface RefreshTokenHasher {
  hash(token: string): string;
}

/** Creates a new unguessable opaque refresh token. */
export interface RefreshTokenGenerator {
  generate(): string;
}
