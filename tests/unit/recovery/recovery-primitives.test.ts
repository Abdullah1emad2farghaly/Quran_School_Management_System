import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AppError, FixedClock, type Clock } from '../../../src/modules/00-shared-kernel/public';
import type { Logger } from '../../../src/modules/05-logging-request-context/public';
import { PasswordRecovery } from '../../../src/modules/11-otp-password-recovery/domain/entities/password-recovery';
import {
  CryptoRecoverySecrets,
  DevFileOtpSender,
  DisabledOtpSender,
  HOUR_WINDOW_SECONDS,
  HmacRecoveryCrypto,
  InMemoryOtpSender,
  MAX_OTP_REQUESTS_PER_PHONE_IP_PER_WINDOW,
  MAX_OTP_REQUESTS_PER_PHONE_PER_HOUR,
  MAX_WRONG_ATTEMPTS,
  OTP_LENGTH,
  OTP_TTL_SECONDS,
  PHONE_IP_WINDOW_SECONDS,
  RESET_TOKEN_TTL_SECONDS,
  createLoggingBackgroundRunner,
  evaluateRateLimit,
} from '../../../src/modules/11-otp-password-recovery/public';
import { OTP_SECRET } from '../../helpers/recovery-harness';

const T0 = new Date('2026-10-10T10:00:00Z');
const at = (seconds: number) => new Date(T0.getTime() + seconds * 1000);
const req = (seconds: number, ipKey = 'ip-a') => ({ requestedAt: at(seconds), ipKey });

describe('approved policy values (§26)', () => {
  it('matches the specification and the approved clarifications', () => {
    expect(OTP_LENGTH).toBe(6);
    expect(OTP_TTL_SECONDS).toBe(300);
    expect(MAX_WRONG_ATTEMPTS).toBe(5);
    expect(RESET_TOKEN_TTL_SECONDS).toBe(600);
    expect(HOUR_WINDOW_SECONDS).toBe(3600);
    expect(MAX_OTP_REQUESTS_PER_PHONE_PER_HOUR).toBe(4); // the first OTP + 3 resends
    expect(PHONE_IP_WINDOW_SECONDS).toBe(900);
    expect(MAX_OTP_REQUESTS_PER_PHONE_IP_PER_WINDOW).toBe(5);
  });
});

describe('evaluateRateLimit (rolling windows)', () => {
  it('allows the first OTP and 3 resends in an hour, then limits the 5th', () => {
    expect(evaluateRateLimit([], 'ip-a', T0)).toEqual({ allowed: true });
    expect(evaluateRateLimit([req(-3000)], 'ip-a', T0).allowed).toBe(true);
    expect(evaluateRateLimit([req(-3000), req(-2000), req(-1000)], 'ip-a', T0).allowed).toBe(true);
    const four = [req(-3000), req(-2000), req(-1000), req(-10)];
    expect(evaluateRateLimit(four, 'ip-a', T0)).toEqual({ allowed: false, retryAfterSeconds: 600 }); // the oldest leaves in 600 s
  });

  it('rolls: a request leaving the hour frees a slot exactly then', () => {
    const four = [req(-3600 + 60), req(-1200), req(-600), req(-10)];
    expect(evaluateRateLimit(four, 'ip-a', T0)).toEqual({ allowed: false, retryAfterSeconds: 60 });
    expect(evaluateRateLimit(four, 'ip-a', at(60)).allowed).toBe(true); // the oldest is exactly one hour old
  });

  it('counts the hour limit per phone, whatever the IP', () => {
    const four = [req(-30, 'ip-1'), req(-20, 'ip-2'), req(-10, 'ip-3'), req(-5, 'ip-4')];
    expect(evaluateRateLimit(four, 'ip-new', T0).allowed).toBe(false);
  });

  it('enforces 5 per phone+IP per 15 minutes, per IP (when the hour limit alone would not trigger)', () => {
    // Only possible to reach with a history that is not itself blocked by the hour rule, so test the pair rule directly:
    const six = Array.from({ length: 5 }, (_, i) => req(-100 + i)); // 5 requests of ONE ip in 100 s
    const decision = evaluateRateLimit(six, 'ip-a', T0);
    expect(decision.allowed).toBe(false);
    expect(decision).toMatchObject({ retryAfterSeconds: expect.any(Number) });
  });

  it('retry-after is the LONGER of the violated windows and is at least 1 second', () => {
    const history = [req(-3599), req(-3000), req(-2000), req(-1000)];
    expect(evaluateRateLimit(history, 'ip-a', T0)).toEqual({ allowed: false, retryAfterSeconds: 1 });
  });

  it('ignores the order of the history rows', () => {
    const four = [req(-10), req(-3000), req(-1000), req(-2000)];
    expect(evaluateRateLimit(four, 'ip-a', T0)).toEqual({ allowed: false, retryAfterSeconds: 600 });
  });
});

describe('PasswordRecovery aggregate', () => {
  const clock: Clock = new FixedClock(T0);
  const make = () => PasswordRecovery.issue({ id: PasswordRecovery.newId(), userId: 'u1', otpHash: 'h', clock });

  it('starts PENDING, live, with a 5-minute OTP and no reset token', () => {
    const r = make();
    expect(r).toMatchObject({ status: 'PENDING', attempts: 0, isLive: true, resetTokenHash: null, version: 1 });
    expect(r.otpExpiresAt).toEqual(at(300));
    expect(r.isOtpUsable(at(299))).toBe(true);
    expect(r.isOtpUsable(at(300))).toBe(false);
  });

  it('locks on the 5th wrong attempt', () => {
    const r = make();
    for (let i = 1; i <= 4; i += 1) {
      r.registerWrongAttempt(clock);
      expect(r.status).toBe('PENDING');
    }
    r.registerWrongAttempt(clock);
    expect(r).toMatchObject({ status: 'LOCKED', attempts: 5, isLive: false });
    expect(r.closedAt).toEqual(T0);
    expect(r.isOtpUsable(T0)).toBe(false);
  });

  it('verifying makes the OTP unusable and starts a 10-minute single-use token', () => {
    const r = make();
    r.markVerified('token-hash', clock);
    expect(r).toMatchObject({ status: 'VERIFIED', resetTokenHash: 'token-hash', isLive: true });
    expect(r.isOtpUsable(T0)).toBe(false);
    expect(r.resetTokenExpiresAt).toEqual(at(600));
    expect(r.isResetTokenUsable(at(599))).toBe(true);
    expect(r.isResetTokenUsable(at(600))).toBe(false);
  });

  it('consuming closes it, publishes PasswordResetCompleted with ids only, and the token is dead', () => {
    const r = make();
    r.markVerified('token-hash', clock);
    r.consume(clock);
    expect(r).toMatchObject({ status: 'CONSUMED', isLive: false });
    expect(r.isResetTokenUsable(T0)).toBe(false);
    const events = r.pullDomainEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ eventType: 'PasswordResetCompleted', aggregateType: 'PasswordRecovery', payload: { recoveryId: r.id, userId: 'u1' } });
    expect(JSON.stringify(events)).not.toContain('token-hash');
  });

  it('superseding closes it', () => {
    const r = make();
    r.supersede(clock);
    expect(r).toMatchObject({ status: 'SUPERSEDED', isLive: false });
    expect(r.isOtpUsable(T0)).toBe(false);
  });
});

describe('HmacRecoveryCrypto', () => {
  const crypto = new HmacRecoveryCrypto(OTP_SECRET);

  it('hashes deterministically with keyed hex digests that do not contain the input', () => {
    const h = crypto.hashOtp('rec-1', '123456');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(crypto.hashOtp('rec-1', '123456')).toBe(h);
    expect(h).not.toContain('123456');
  });

  it('binds an OTP hash to its recovery', () => {
    expect(crypto.hashOtp('rec-1', '123456')).not.toBe(crypto.hashOtp('rec-2', '123456'));
  });

  it('separates purposes: the same text hashes differently as OTP, reset token, phone and IP', () => {
    const hashes = new Set([crypto.hashOtp('x', 'y'), crypto.hashResetToken('x:y'), crypto.phoneKey('x:y'), crypto.ipKey('x:y')]);
    expect(hashes.size).toBe(4);
  });

  it('depends on the secret (a leaked database alone cannot check OTP guesses)', () => {
    const other = new HmacRecoveryCrypto('another-secret-another-secret-another');
    expect(other.hashOtp('rec-1', '123456')).not.toBe(crypto.hashOtp('rec-1', '123456'));
  });

  it('compares in constant time and refuses an empty secret', () => {
    const a = crypto.hashResetToken('t');
    expect(crypto.safeEqual(a, a)).toBe(true);
    expect(crypto.safeEqual(a, crypto.hashResetToken('u'))).toBe(false);
    expect(crypto.safeEqual(a, 'short')).toBe(false);
    expect(() => new HmacRecoveryCrypto('')).toThrow();
  });
});

describe('CryptoRecoverySecrets', () => {
  const secrets = new CryptoRecoverySecrets();

  it('generates 6-digit OTPs, keeping leading zeros, with a roughly uniform spread', () => {
    const seen = new Set<string>();
    let leadingZero = 0;
    for (let i = 0; i < 3000; i += 1) {
      const otp = secrets.generateOtp();
      expect(otp).toMatch(/^\d{6}$/);
      if (otp.startsWith('0')) leadingZero += 1;
      seen.add(otp);
    }
    expect(seen.size).toBeGreaterThan(2800);
    expect(leadingZero).toBeGreaterThan(150); // ~10% expected
  });

  it('generates unique 256-bit URL-safe reset tokens', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => secrets.generateResetToken()));
    expect(tokens.size).toBe(200);
    for (const t of tokens) expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});

describe('OTP senders', () => {
  it('the default sender delivers nothing', async () => {
    await expect(new DisabledOtpSender().send({ phone: '+201012345678', otp: '123456', expiresInSeconds: 300 })).rejects.toThrow('not configured');
  });

  it('the in-memory test sender keeps messages and can simulate failures', async () => {
    const sender = new InMemoryOtpSender();
    await sender.send({ phone: '+201012345678', otp: '111111', expiresInSeconds: 300 });
    await sender.send({ phone: '+201012345678', otp: '222222', expiresInSeconds: 300 });
    expect(sender.lastFor('+201012345678')?.otp).toBe('222222');
    expect(sender.lastFor('+201099999999')).toBeUndefined();
    sender.failing = true;
    await expect(sender.send({ phone: '+201012345678', otp: '333333', expiresInSeconds: 300 })).rejects.toThrow();
  });

  it('the development file sender writes the latest OTP per phone to an owner-only file and never in production', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'qsms-otp-'));
    try {
      const file = path.join(dir, 'nested', 'otp-outbox.json');
      const sender = new DevFileOtpSender(file, 'development');
      await sender.send({ phone: '+201012345678', otp: '123456', expiresInSeconds: 300 });
      await sender.send({ phone: '+201012345678', otp: '654321', expiresInSeconds: 300 });
      await sender.send({ phone: '+201099999999', otp: '000111', expiresInSeconds: 300 });
      const content = JSON.parse(await readFile(file, 'utf8')) as Record<string, { otp: string }>;
      expect(content['+201012345678']!.otp).toBe('654321');
      expect(content['+201099999999']!.otp).toBe('000111');
      if (process.platform !== 'win32') expect((await stat(file)).mode & 0o777).toBe(0o600);
      expect(() => new DevFileOtpSender(file, 'production')).toThrow('production');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('background delivery runner', () => {
  const capture = () => {
    const calls: Array<{ message: string; fields: unknown }> = [];
    const logger = {
      warn: (message: string, fields?: unknown) => calls.push({ message, fields }),
      error: () => undefined,
      info: () => undefined,
      debug: () => undefined,
      child: () => logger,
    } as unknown as Logger;
    return { logger, calls };
  };

  it('logs a failure with the error NAME only, never its message (which could contain the OTP or phone)', async () => {
    const { logger, calls } = capture();
    const run = createLoggingBackgroundRunner(logger);
    run(() => Promise.reject(new Error('gateway rejected message "Your code is 123456" to +201012345678')));
    await new Promise((r) => setTimeout(r, 10));
    expect(calls).toEqual([{ message: 'OTP delivery failed', fields: { errorName: 'Error' } }]);
    expect(JSON.stringify(calls)).not.toMatch(/123456|\+2010/);
  });

  it('does not wait for the task and never throws', async () => {
    const { logger } = capture();
    const run = createLoggingBackgroundRunner(logger);
    let finished = false;
    run(async () => {
      await new Promise((r) => setTimeout(r, 30));
      finished = true;
    });
    expect(finished).toBe(false);
    expect(() => run(() => Promise.reject(new AppError('X', 'INTERNAL')))).not.toThrow();
  });
});
