import { createHmac, randomBytes } from 'node:crypto';
import type { RefreshTokenGenerator, RefreshTokenHasher } from '../../application/ports/token-ports';

/**
 * Refresh tokens are 256-bit random opaque strings, so a fast keyed hash is the right tool (there is nothing to
 * brute-force). The key is JWT_REFRESH_SECRET: a database leak alone is not enough to check guesses.
 */
export class HmacRefreshTokenHasher implements RefreshTokenHasher {
  constructor(private readonly secret: string) {
    if (!secret) throw new Error('JWT_REFRESH_SECRET is not configured');
  }

  hash(token: string): string {
    return createHmac('sha256', this.secret).update(token, 'utf8').digest('hex');
  }
}

export class CryptoRefreshTokenGenerator implements RefreshTokenGenerator {
  generate(): string {
    return randomBytes(32).toString('base64url');
  }
}
