import { SystemClock, type Clock, type UnitOfWork } from '../../../00-shared-kernel/public';
import type { OutboxService } from '../../../06-domain-events-outbox/public';
import { assertPasswordPolicy, normalizePhone, type IdentityService } from '../../../08-identity-core/public';
import type { SessionService } from '../../../10-sessions-jwt/public';
import { PasswordRecovery } from '../../domain/entities/password-recovery';
import { rateLimitedError, recoveryError } from '../../domain/errors/recovery-errors';
import { evaluateRateLimit } from '../../domain/services/rate-limit-policy';
import { HOUR_WINDOW_SECONDS, OTP_LENGTH, OTP_TTL_SECONDS } from '../../domain/value-objects/recovery-policy';
import type { BackgroundRunner, OtpSender, RecoveryCrypto, RecoveryRepository, RecoverySecrets } from '../ports/recovery-ports';

export interface PasswordRecoveryServiceDeps {
  readonly repository: RecoveryRepository;
  readonly identity: Pick<IdentityService, 'findByPhone' | 'findById' | 'changePassword'>;
  readonly sessions: Pick<SessionService, 'revokeAllForUser'>;
  readonly crypto: RecoveryCrypto;
  readonly secrets: RecoverySecrets;
  readonly sender: OtpSender;
  readonly runInBackground: BackgroundRunner;
  readonly unitOfWork: UnitOfWork;
  readonly outbox: OutboxService;
  readonly clock?: Clock;
}

export interface RequestRecoveryResult {
  /** Always the same value, whether or not an OTP was actually sent. */
  readonly expiresInSeconds: number;
}

export interface VerifyOtpResult {
  readonly resetToken: string;
  readonly resetTokenExpiresAt: Date;
}

type VerifyOutcome = { kind: 'invalid' } | { kind: 'ok'; resetToken: string; resetTokenExpiresAt: Date };
type ResetOutcome = { kind: 'invalid' } | { kind: 'ok' };
type RequestOutcome =
  | { kind: 'limited'; retryAfterSeconds: number }
  | { kind: 'issued'; phone: string; otp: string }
  | { kind: 'nothing' };

const MAX_TOKEN_LENGTH = 200;
const OTP_FORMAT = new RegExp(`^\\d{${OTP_LENGTH}}$`);
const UNKNOWN_RECOVERY_ID = '00000000-0000-0000-0000-000000000000';

/**
 * Public application contract of Module 11: forgot-password with an OTP (Master Specification §26).
 *
 *   request(phone) -> OTP sent -> verifyOtp(phone, otp) -> resetToken -> resetPassword(resetToken, newPassword)
 *
 * Security properties:
 *  - No account enumeration: unknown, inactive and active accounts get identical answers, the same rate limits
 *    (every request counts) and the same generic errors; delivery happens in the background.
 *  - The OTP, the reset token, phones and IPs are stored only as keyed hashes (HMAC with OTP_HMAC_SECRET); the OTP
 *    never reaches logs, events or the outbox.
 *  - 5 wrong OTP attempts invalidate the OTP; the OTP is single use; the reset token is single use and expires in 10 minutes.
 *  - A successful reset changes the password, closes the recovery and revokes ALL the user's sessions in ONE transaction.
 */
export class PasswordRecoveryService {
  private readonly repository: RecoveryRepository;
  private readonly identity: PasswordRecoveryServiceDeps['identity'];
  private readonly sessions: PasswordRecoveryServiceDeps['sessions'];
  private readonly crypto: RecoveryCrypto;
  private readonly secrets: RecoverySecrets;
  private readonly sender: OtpSender;
  private readonly runInBackground: BackgroundRunner;
  private readonly unitOfWork: UnitOfWork;
  private readonly outbox: OutboxService;
  private readonly clock: Clock;

  constructor(deps: PasswordRecoveryServiceDeps) {
    this.repository = deps.repository;
    this.identity = deps.identity;
    this.sessions = deps.sessions;
    this.crypto = deps.crypto;
    this.secrets = deps.secrets;
    this.sender = deps.sender;
    this.runInBackground = deps.runInBackground;
    this.unitOfWork = deps.unitOfWork;
    this.outbox = deps.outbox;
    this.clock = deps.clock ?? new SystemClock();
  }

  /**
   * Starts (or restarts = resends) a recovery. Throws INVALID_PHONE_NUMBER for a malformed phone (format only) and
   * RATE_LIMITED (429, with retryAfterSeconds) beyond the limits. Otherwise it ALWAYS answers the same way.
   */
  async requestRecovery(input: { phone: unknown; clientIp?: string | undefined }): Promise<RequestRecoveryResult> {
    const phone = normalizePhone(input.phone);
    const phoneKey = this.crypto.phoneKey(phone);
    const ipKey = this.crypto.ipKey(normalizeIp(input.clientIp));
    const user = await this.identity.findByPhone(phone);
    const otp = this.secrets.generateOtp(); // generated for every request so the work is the same for unknown phones

    const outcome = await this.unitOfWork.run<RequestOutcome>(async (tx) => {
      const now = this.clock.now();
      // 1) serialize all requests of this phone; 2) count the rolling windows; 3) record this request.
      await this.repository.lockPhone(phoneKey, now, tx);
      const history = await this.repository.listRequestsSince(phoneKey, new Date(now.getTime() - HOUR_WINDOW_SECONDS * 1000), tx);
      const decision = evaluateRateLimit(history, ipKey, now);
      if (!decision.allowed) return { kind: 'limited', retryAfterSeconds: decision.retryAfterSeconds };
      await this.repository.recordRequest(phoneKey, ipKey, now, tx);

      if (!user || !user.isActive) return { kind: 'nothing' };

      // A resend invalidates the previous OTP.
      for (const previous of await this.repository.lockLiveByUser(user.id, tx)) {
        previous.supersede(this.clock);
        await this.repository.update(previous, tx);
      }
      const id = PasswordRecovery.newId();
      await this.repository.insert(
        PasswordRecovery.issue({ id, userId: user.id, otpHash: this.crypto.hashOtp(id, otp), clock: this.clock }),
        tx,
      );
      return { kind: 'issued', phone: user.phone, otp };
    });

    if (outcome.kind === 'limited') throw rateLimitedError(outcome.retryAfterSeconds);
    if (outcome.kind === 'issued') {
      // After the commit, in the background: a delivery failure never changes the answer or rolls anything back.
      const message = { phone: outcome.phone, otp: outcome.otp, expiresInSeconds: OTP_TTL_SECONDS };
      this.runInBackground(() => this.sender.send(message));
    }
    return { expiresInSeconds: OTP_TTL_SECONDS };
  }

  /**
   * Checks the OTP. Success returns a single-use reset token (valid 10 minutes). Every failure (wrong, expired,
   * already used, locked, unknown or inactive account, malformed input) gives the same OTP_INVALID. A wrong OTP counts
   * as an attempt; the 5th invalidates the OTP.
   */
  async verifyOtp(input: { phone: unknown; otp: unknown }): Promise<VerifyOtpResult> {
    const phone = typeof input.phone === 'string' ? safePhone(input.phone) : undefined;
    const otp = typeof input.otp === 'string' && OTP_FORMAT.test(input.otp) ? input.otp : undefined;
    const user = phone ? await this.identity.findByPhone(phone) : undefined;

    // Decisions are returned (not thrown) so a wrong attempt is COMMITTED even though the request fails.
    const outcome = await this.unitOfWork.run<VerifyOutcome>(async (tx) => {
      if (!user || !user.isActive || otp === undefined) {
        this.crypto.hashOtp(UNKNOWN_RECOVERY_ID, otp ?? '000000'); // same work as a real check
        return { kind: 'invalid' };
      }
      const now = this.clock.now();
      const recovery = (await this.repository.lockLiveByUser(user.id, tx)).find((r) => r.status === 'PENDING');
      if (!recovery || !recovery.isOtpUsable(now)) return { kind: 'invalid' };

      if (!this.crypto.safeEqual(this.crypto.hashOtp(recovery.id, otp), recovery.otpHash)) {
        recovery.registerWrongAttempt(this.clock);
        await this.repository.update(recovery, tx);
        return { kind: 'invalid' };
      }
      const resetToken = this.secrets.generateResetToken();
      recovery.markVerified(this.crypto.hashResetToken(resetToken), this.clock);
      await this.repository.update(recovery, tx);
      return { kind: 'ok', resetToken, resetTokenExpiresAt: recovery.resetTokenExpiresAt as Date };
    });

    if (outcome.kind === 'invalid') throw recoveryError('OTP_INVALID');
    return { resetToken: outcome.resetToken, resetTokenExpiresAt: outcome.resetTokenExpiresAt };
  }

  /**
   * Sets a new password with the reset token (4-12 characters, §23). The token is single use and bound to the user
   * who verified the OTP. A password that breaks the policy is rejected WITHOUT using up the token. On success the
   * password changes, the recovery closes and every session of the user is revoked, atomically.
   */
  async resetPassword(input: { resetToken: unknown; newPassword: unknown }): Promise<void> {
    if (typeof input.resetToken !== 'string' || input.resetToken === '' || input.resetToken.length > MAX_TOKEN_LENGTH) {
      throw recoveryError('RESET_TOKEN_INVALID');
    }
    assertPasswordPolicy(input.newPassword);
    const newPassword = input.newPassword;
    const tokenHash = this.crypto.hashResetToken(input.resetToken);

    const outcome = await this.unitOfWork.run<ResetOutcome>(async (tx) => {
      const probe = await this.repository.findByResetTokenHash(tokenHash, tx);
      if (!probe) return { kind: 'invalid' };
      const recovery = await this.repository.lock(probe.id, tx); // decide on the LOCKED row
      if (!recovery || !recovery.isResetTokenUsable(this.clock.now())) return { kind: 'invalid' };

      const user = await this.identity.findById(recovery.userId, tx);
      if (!user || !user.isActive) {
        recovery.supersede(this.clock);
        await this.repository.update(recovery, tx);
        return { kind: 'invalid' };
      }

      await this.identity.changePassword(recovery.userId, newPassword, tx);
      recovery.consume(this.clock);
      await this.repository.update(recovery, tx);
      await this.outbox.publishFrom(recovery, tx);
      await this.sessions.revokeAllForUser(recovery.userId, 'PASSWORD_RESET', tx);
      return { kind: 'ok' };
    });

    if (outcome.kind === 'invalid') throw recoveryError('RESET_TOKEN_INVALID');
  }
}

function safePhone(raw: string): string | undefined {
  try {
    return normalizePhone(raw);
  } catch {
    return undefined;
  }
}

/** `::ffff:1.2.3.4` and `1.2.3.4` are the same client. */
function normalizeIp(ip: string | undefined): string {
  if (!ip) return 'unknown';
  return ip.replace(/^::ffff:/i, '').toLowerCase();
}
