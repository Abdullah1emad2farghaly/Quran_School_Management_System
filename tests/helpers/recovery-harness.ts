import {
  CryptoRecoverySecrets,
  HmacRecoveryCrypto,
  InMemoryOtpSender,
  InMemoryRecoveryRepository,
  PasswordRecoveryService,
} from '../../src/modules/11-otp-password-recovery/public';
import { createSessionHarness } from './session-harness';

export const OTP_SECRET = 'test-otp-hmac-secret-0123456789abcdef-C';

/** In-memory wiring of Modules 08-11 sharing one controllable clock. */
export function createRecoveryHarness() {
  const base = createSessionHarness();
  const repository = new InMemoryRecoveryRepository();
  const sender = new InMemoryOtpSender();
  const crypto = new HmacRecoveryCrypto(OTP_SECRET);

  // Delivery runs "in the background": collect the promises so tests can wait for them.
  const pending: Promise<void>[] = [];
  const runInBackground = (task: () => Promise<void>) => {
    pending.push(task().catch(() => undefined));
  };
  const flush = async () => {
    await Promise.all(pending.splice(0));
  };

  const recovery = new PasswordRecoveryService({
    repository,
    identity: base.identity,
    sessions: base.service,
    crypto,
    secrets: new CryptoRecoverySecrets(),
    sender,
    runInBackground,
    unitOfWork: base.unitOfWork,
    outbox: base.outbox,
    clock: base.clock,
  });
  // `repository` is the RECOVERY repository; the session repository of Module 10 is `sessionRepository`.
  return { ...base, sessionRepository: base.repository, recovery, repository, sender, crypto, flush };
}

/** E.164 form of a harness user's local phone. */
export const e164 = (localPhone: string): string => `+20${localPhone.slice(1)}`;
