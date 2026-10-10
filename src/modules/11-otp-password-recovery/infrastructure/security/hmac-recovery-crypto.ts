import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import type { RecoveryCrypto, RecoverySecrets } from '../../application/ports/recovery-ports';
import { OTP_LENGTH } from '../../domain/value-objects/recovery-policy';

/**
 * Keyed hashing with a DEDICATED secret (OTP_HMAC_SECRET, never a JWT secret). One sub-key per purpose is derived from
 * it, so a hash made for one purpose can never be used for another (an OTP hash is useless as a reset-token hash).
 * A 6-digit OTP has only 1,000,000 values, so an unkeyed hash would be brute-forced instantly if the database leaked;
 * keyed with a secret that is not in the database, the stored hashes cannot be checked offline.
 */
export class HmacRecoveryCrypto implements RecoveryCrypto {
  private readonly otpKey: Buffer;
  private readonly resetKey: Buffer;
  private readonly phoneKeyKey: Buffer;
  private readonly ipKeyKey: Buffer;

  constructor(secret: string) {
    if (!secret) throw new Error('OTP_HMAC_SECRET is not configured');
    const derive = (label: string) => createHmac('sha256', secret).update(`qsms:password-recovery:${label}`, 'utf8').digest();
    this.otpKey = derive('otp');
    this.resetKey = derive('reset-token');
    this.phoneKeyKey = derive('phone');
    this.ipKeyKey = derive('ip');
  }

  hashOtp(recoveryId: string, otp: string): string {
    return this.hmac(this.otpKey, `${recoveryId}:${otp}`); // bound to ONE recovery
  }
  hashResetToken(token: string): string {
    return this.hmac(this.resetKey, token);
  }
  phoneKey(phone: string): string {
    return this.hmac(this.phoneKeyKey, phone);
  }
  ipKey(ip: string): string {
    return this.hmac(this.ipKeyKey, ip);
  }

  safeEqual(a: string, b: string): boolean {
    const x = Buffer.from(a, 'utf8');
    const y = Buffer.from(b, 'utf8');
    return x.length === y.length && timingSafeEqual(x, y);
  }

  private hmac(key: Buffer, value: string): string {
    return createHmac('sha256', key).update(value, 'utf8').digest('hex');
  }
}

export class CryptoRecoverySecrets implements RecoverySecrets {
  generateOtp(): string {
    return String(randomInt(0, 10 ** OTP_LENGTH)).padStart(OTP_LENGTH, '0'); // uniform, leading zeros kept
  }
  generateResetToken(): string {
    return randomBytes(32).toString('base64url');
  }
}
