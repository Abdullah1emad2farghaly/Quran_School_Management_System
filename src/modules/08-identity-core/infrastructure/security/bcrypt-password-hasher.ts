import bcrypt from 'bcryptjs';
import type { PasswordHasher } from '../../application/ports/password-hasher';

export const DEFAULT_BCRYPT_ROUNDS = 10;

/** bcrypt (bcryptjs). `rounds` is the cost factor; tests use a low value for speed. */
export class BcryptPasswordHasher implements PasswordHasher {
  constructor(private readonly rounds: number = DEFAULT_BCRYPT_ROUNDS) {
    if (!Number.isInteger(rounds) || rounds < 4 || rounds > 15) {
      throw new Error('BcryptPasswordHasher: rounds must be an integer between 4 and 15');
    }
  }

  hash(plain: string): Promise<string> {
    return bcrypt.hash(plain, this.rounds);
  }

  async verify(plain: string, hash: string): Promise<boolean> {
    try {
      return await bcrypt.compare(plain, hash);
    } catch {
      return false;
    }
  }
}
