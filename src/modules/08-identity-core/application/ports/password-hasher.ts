/** Passwords are only ever stored hashed (Master Specification §23, §86). */
export interface PasswordHasher {
  hash(plain: string): Promise<string>;
  /** Never throws for a malformed hash; returns false. */
  verify(plain: string, hash: string): Promise<boolean>;
}
