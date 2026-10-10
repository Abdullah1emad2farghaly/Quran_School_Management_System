import path from 'node:path';
import { SystemClock } from '../modules/00-shared-kernel/public';
import {
  CryptoRecoverySecrets,
  DevFileOtpSender,
  DisabledOtpSender,
  HmacRecoveryCrypto,
  PasswordRecoveryService,
  SequelizeRecoveryRepository,
  createLoggingBackgroundRunner,
  type OtpSender,
} from '../modules/11-otp-password-recovery/public';
import { getSequelize, getUnitOfWork } from './database';
import { env } from './env';
import { getIdentityService } from './identity';
import { logger } from './logger';
import { getOutboxService } from './outbox';
import { getSessionService } from './sessions';

let service: PasswordRecoveryService | undefined;

/**
 * The OTP delivery provider. The real SMS/WhatsApp provider is chosen later: add it here and as a new OTP_SENDER value.
 * Until then production sends nothing, and development can use the file sender (OTP_SENDER=dev-file).
 */
function createOtpSender(): OtpSender {
  if (env.otp.sender === 'dev-file') return new DevFileOtpSender(path.resolve('.dev-otp', 'otp-outbox.json'), env.nodeEnv);
  return new DisabledOtpSender();
}

/** Inject into routes (never construct PasswordRecoveryService elsewhere). Needs OTP_HMAC_SECRET. */
export function getPasswordRecoveryService(): PasswordRecoveryService {
  if (!service) {
    const { hmacSecret } = env.otp;
    if (!hmacSecret) throw new Error('OTP_HMAC_SECRET must be set to use password recovery');
    if (hmacSecret === env.jwt.accessSecret || hmacSecret === env.jwt.refreshSecret) {
      throw new Error('OTP_HMAC_SECRET must be different from the JWT secrets');
    }
    service = new PasswordRecoveryService({
      repository: new SequelizeRecoveryRepository(getSequelize()),
      identity: getIdentityService(),
      sessions: getSessionService(),
      crypto: new HmacRecoveryCrypto(hmacSecret),
      secrets: new CryptoRecoverySecrets(),
      sender: createOtpSender(),
      runInBackground: createLoggingBackgroundRunner(logger),
      unitOfWork: getUnitOfWork(),
      outbox: getOutboxService(),
      clock: new SystemClock(),
    });
  }
  return service;
}
