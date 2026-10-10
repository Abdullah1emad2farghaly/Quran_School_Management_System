import { describe, expect, it } from 'vitest';
import { AppError } from '../../../src/modules/00-shared-kernel/public';
import { createRecoveryHarness, e164 } from '../../helpers/recovery-harness';

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof AppError) return e.code;
    throw e;
  }
  return 'OK';
}
async function errorOf(p: Promise<unknown>): Promise<AppError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof AppError) return e;
    throw e;
  }
  throw new Error('expected the call to fail');
}
const MIN = 60_000;

/** request an OTP and read it from the test sender */
async function requestOtp(h: ReturnType<typeof createRecoveryHarness>, phone: string, ip = '203.0.113.5') {
  await h.recovery.requestRecovery({ phone, clientIp: ip });
  await h.flush();
  return h.sender.lastFor(e164(phone))!.otp;
}

describe('requestRecovery', () => {
  it('sends a 6-digit OTP to the normalized phone and stores only a hash', async () => {
    const h = createRecoveryHarness();
    const u = await h.createUser();
    const result = await h.recovery.requestRecovery({ phone: u.phone, clientIp: '203.0.113.5' });
    await h.flush();

    expect(result).toEqual({ expiresInSeconds: 300 });
    const message = h.sender.lastFor(e164(u.phone))!;
    expect(message.otp).toMatch(/^\d{6}$/);
    expect(message.expiresInSeconds).toBe(300);

    const rows = [...h.repository.recoveries.values()];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: u.id, status: 'PENDING', attempts: 0 });
    expect(rows[0]!.otpExpiresAt).toEqual(new Date(h.clock.now().getTime() + 5 * MIN));
    expect(JSON.stringify(rows)).not.toContain(message.otp);
    expect(JSON.stringify(h.store.messages)).not.toContain(message.otp);
  });

  it('gives the SAME answer for an active, an unknown and an inactive account, and sends only to the active one', async () => {
    const h = createRecoveryHarness();
    const active = await h.createUser();
    const inactive = await h.createUser();
    await h.identity.deactivateUser(inactive.id);

    const a = await h.recovery.requestRecovery({ phone: active.phone, clientIp: '1.1.1.1' });
    const b = await h.recovery.requestRecovery({ phone: '01099999999', clientIp: '1.1.1.1' });
    const c = await h.recovery.requestRecovery({ phone: inactive.phone, clientIp: '1.1.1.1' });
    await h.flush();

    expect(b).toEqual(a);
    expect(c).toEqual(a);
    expect(h.sender.messages.map((m) => m.phone)).toEqual([e164(active.phone)]);
    expect(h.repository.recoveries.size).toBe(1);
  });

  it('accepts the phone in any supported format', async () => {
    const h = createRecoveryHarness();
    const u = await h.createUser();
    await h.recovery.requestRecovery({ phone: `00${e164(u.phone).slice(1)}`, clientIp: '1.1.1.1' });
    await h.flush();
    expect(h.sender.messages).toHaveLength(1);
  });

  it('rejects a malformed phone without recording anything', async () => {
    const h = createRecoveryHarness();
    for (const phone of ['abc', '', 123, undefined]) {
      expect(await codeOf(h.recovery.requestRecovery({ phone, clientIp: '1.1.1.1' }))).toBe('INVALID_PHONE_NUMBER');
    }
    expect(h.repository.requests).toHaveLength(0);
  });

  it('a resend invalidates the previous OTP and keeps exactly one live recovery', async () => {
    const h = createRecoveryHarness();
    const u = await h.createUser();
    const first = await requestOtp(h, u.phone);
    h.advance(MIN);
    const second = await requestOtp(h, u.phone);

    const rows = [...h.repository.recoveries.values()];
    expect(rows.map((r) => r.status)).toEqual(['SUPERSEDED', 'PENDING']);
    expect(rows.filter((r) => r.status === 'PENDING' || r.status === 'VERIFIED')).toHaveLength(1);
    if (first !== second) expect(await codeOf(h.recovery.verifyOtp({ phone: u.phone, otp: first }))).toBe('OTP_INVALID');
    expect((await h.recovery.verifyOtp({ phone: u.phone, otp: second })).resetToken).toBeTruthy();
  });

  it('a delivery failure is invisible to the caller (no error, same answer, nothing leaked)', async () => {
    const h = createRecoveryHarness();
    const u = await h.createUser();
    h.sender.failing = true;
    const failed = await h.recovery.requestRecovery({ phone: u.phone, clientIp: '1.1.1.1' });
    await h.flush();
    h.sender.failing = false;
    const unknown = await h.recovery.requestRecovery({ phone: '01099999999', clientIp: '1.1.1.1' });
    expect(failed).toEqual(unknown);
    expect(h.sender.messages).toHaveLength(0);
  });

  it('does not wait for delivery (so timing cannot reveal whether the account exists)', async () => {
    const h = createRecoveryHarness();
    const u = await h.createUser();
    let delivered = false;
    h.sender.send = async () => {
      await new Promise((r) => setTimeout(r, 50));
      delivered = true;
    };
    await h.recovery.requestRecovery({ phone: u.phone, clientIp: '1.1.1.1' });
    expect(delivered).toBe(false);
    await h.flush();
    expect(delivered).toBe(true);
  });

  it('stores only keyed hashes of the phone and the IP in the request log', async () => {
    const h = createRecoveryHarness();
    const u = await h.createUser();
    await h.recovery.requestRecovery({ phone: u.phone, clientIp: '203.0.113.77' });
    const dump = JSON.stringify([...h.repository.requests, ...h.repository.phoneLocks]);
    expect(dump).not.toContain('203.0.113.77');
    expect(dump).not.toContain(u.phone.slice(1));
    expect(h.repository.requests[0]!.ipKey).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('rate limits (4 OTPs per phone per rolling hour, answered with 429)', () => {
  it('allows the first OTP + 3 resends, then limits with the right Retry-After', async () => {
    const h = createRecoveryHarness();
    const u = await h.createUser();
    for (let i = 0; i < 4; i += 1) {
      await h.recovery.requestRecovery({ phone: u.phone, clientIp: `10.0.0.${i}` });
      h.advance(MIN);
    }
    const err = await errorOf(h.recovery.requestRecovery({ phone: u.phone, clientIp: '10.0.0.9' }));
    expect(err).toMatchObject({ code: 'RATE_LIMITED', kind: 'RATE_LIMITED', details: { retryAfterSeconds: 3600 - 4 * 60 } });
  });

  it('frees a slot exactly one hour after the oldest request (rolling window)', async () => {
    const h = createRecoveryHarness();
    const u = await h.createUser();
    for (let i = 0; i < 4; i += 1) await h.recovery.requestRecovery({ phone: u.phone, clientIp: '1.1.1.1' });
    h.advance(60 * MIN - 1000);
    expect(await codeOf(h.recovery.requestRecovery({ phone: u.phone, clientIp: '1.1.1.1' }))).toBe('RATE_LIMITED');
    h.advance(1000);
    expect(await codeOf(h.recovery.requestRecovery({ phone: u.phone, clientIp: '1.1.1.1' }))).toBe('OK');
  });

  it('limits unknown and inactive phones exactly like active ones (no account information in the limits)', async () => {
    const h = createRecoveryHarness();
    const inactive = await h.createUser();
    await h.identity.deactivateUser(inactive.id);
    for (const phone of ['01099999999', inactive.phone]) {
      const codes: string[] = [];
      for (let i = 0; i < 6; i += 1) codes.push(await codeOf(h.recovery.requestRecovery({ phone, clientIp: '1.1.1.1' })));
      expect(codes).toEqual(['OK', 'OK', 'OK', 'OK', 'RATE_LIMITED', 'RATE_LIMITED']);
    }
  });

  it('does not record rejected requests (so a blocked caller does not extend the block)', async () => {
    const h = createRecoveryHarness();
    const u = await h.createUser();
    for (let i = 0; i < 8; i += 1) await codeOf(h.recovery.requestRecovery({ phone: u.phone, clientIp: '1.1.1.1' }));
    expect(h.repository.requests).toHaveLength(4);
  });

  it('shares the hour limit across IPs, but keeps different phones independent', async () => {
    const h = createRecoveryHarness();
    const a = await h.createUser();
    const b = await h.createUser();
    for (let i = 0; i < 4; i += 1) await h.recovery.requestRecovery({ phone: a.phone, clientIp: `10.0.0.${i}` });
    expect(await codeOf(h.recovery.requestRecovery({ phone: a.phone, clientIp: '198.51.100.1' }))).toBe('RATE_LIMITED');
    expect(await codeOf(h.recovery.requestRecovery({ phone: b.phone, clientIp: '10.0.0.0' }))).toBe('OK');
  });

  it('a limited request sends no OTP and leaves the live OTP untouched', async () => {
    const h = createRecoveryHarness();
    const u = await h.createUser();
    for (let i = 0; i < 4; i += 1) await requestOtp(h, u.phone);
    const sent = h.sender.messages.length;
    await codeOf(h.recovery.requestRecovery({ phone: u.phone, clientIp: '203.0.113.5' }));
    await h.flush();
    expect(h.sender.messages).toHaveLength(sent);
    expect([...h.repository.recoveries.values()].filter((r) => r.status === 'PENDING')).toHaveLength(1);
  });
});

describe('verifyOtp', () => {
  it('returns a single-use reset token valid for 10 minutes and stores only its hash', async () => {
    const h = createRecoveryHarness();
    const u = await h.createUser();
    const otp = await requestOtp(h, u.phone);
    const result = await h.recovery.verifyOtp({ phone: u.phone, otp });

    expect(result.resetToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(result.resetTokenExpiresAt).toEqual(new Date(h.clock.now().getTime() + 10 * MIN));
    const row = [...h.repository.recoveries.values()][0]!;
    expect(row.status).toBe('VERIFIED');
    expect(row.resetTokenHash).toBe(h.crypto.hashResetToken(result.resetToken));
    expect(JSON.stringify(row)).not.toContain(result.resetToken);
  });

  it('counts wrong attempts and invalidates the OTP after the 5th (even for the correct code)', async () => {
    const h = createRecoveryHarness();
    const u = await h.createUser();
    const otp = await requestOtp(h, u.phone);
    const wrong = otp === '000000' ? '111111' : '000000';

    for (let i = 1; i <= 4; i += 1) {
      expect(await codeOf(h.recovery.verifyOtp({ phone: u.phone, otp: wrong }))).toBe('OTP_INVALID');
      expect([...h.repository.recoveries.values()][0]).toMatchObject({ attempts: i, status: 'PENDING' });
    }
    expect(await codeOf(h.recovery.verifyOtp({ phone: u.phone, otp: wrong }))).toBe('OTP_INVALID');
    expect([...h.repository.recoveries.values()][0]).toMatchObject({ attempts: 5, status: 'LOCKED' });
    expect(await codeOf(h.recovery.verifyOtp({ phone: u.phone, otp }))).toBe('OTP_INVALID'); // the right code no longer works

    const fresh = await requestOtp(h, u.phone); // a new request is required
    expect((await h.recovery.verifyOtp({ phone: u.phone, otp: fresh })).resetToken).toBeTruthy();
  });

  it('4 wrong attempts followed by the right OTP still succeeds', async () => {
    const h = createRecoveryHarness();
    const u = await h.createUser();
    const otp = await requestOtp(h, u.phone);
    const wrong = otp === '000000' ? '111111' : '000000';
    for (let i = 0; i < 4; i += 1) await codeOf(h.recovery.verifyOtp({ phone: u.phone, otp: wrong }));
    expect((await h.recovery.verifyOtp({ phone: u.phone, otp })).resetToken).toBeTruthy();
  });

  it('rejects an expired OTP (5 minutes), even the right one', async () => {
    const h = createRecoveryHarness();
    const u = await h.createUser();
    const otp = await requestOtp(h, u.phone);
    h.advance(5 * MIN - 1000);
    expect(await codeOf(h.recovery.verifyOtp({ phone: u.phone, otp }))).toBe('OK');
    const h2 = createRecoveryHarness();
    const u2 = await h2.createUser();
    const otp2 = await requestOtp(h2, u2.phone);
    h2.advance(5 * MIN);
    expect(await codeOf(h2.recovery.verifyOtp({ phone: u2.phone, otp: otp2 }))).toBe('OTP_INVALID');
  });

  it('is single use: the same OTP cannot be verified twice', async () => {
    const h = createRecoveryHarness();
    const u = await h.createUser();
    const otp = await requestOtp(h, u.phone);
    await h.recovery.verifyOtp({ phone: u.phone, otp });
    expect(await codeOf(h.recovery.verifyOtp({ phone: u.phone, otp }))).toBe('OTP_INVALID');
  });

  it('gives the same generic error for every kind of failure', async () => {
    const h = createRecoveryHarness();
    const active = await h.createUser();
    const inactive = await h.createUser();
    await requestOtp(h, inactive.phone);
    await h.identity.deactivateUser(inactive.id);
    const neverRequested = await h.createUser();
    await requestOtp(h, active.phone);

    const cases = [
      { phone: '01099999999', otp: '123456' }, // unknown
      { phone: inactive.phone, otp: '123456' }, // inactive
      { phone: neverRequested.phone, otp: '123456' }, // no recovery started
      { phone: 'not a phone', otp: '123456' }, // malformed phone
      { phone: active.phone, otp: '12345' }, // malformed otp
      { phone: active.phone, otp: 'abcdef' },
      { phone: active.phone, otp: 123456 },
      { phone: undefined, otp: undefined },
    ];
    for (const c of cases) {
      const err = await errorOf(h.recovery.verifyOtp(c));
      expect(err.code, JSON.stringify(c)).toBe('OTP_INVALID');
    }
  });

  it('does not count a malformed OTP as an attempt', async () => {
    const h = createRecoveryHarness();
    const u = await h.createUser();
    await requestOtp(h, u.phone);
    for (const otp of ['1', 'abcdef', '1234567', '']) await codeOf(h.recovery.verifyOtp({ phone: u.phone, otp }));
    expect([...h.repository.recoveries.values()][0]!.attempts).toBe(0);
  });

  it('does not accept the reset token as an OTP, nor the OTP as a reset token', async () => {
    const h = createRecoveryHarness();
    const u = await h.createUser();
    const otp = await requestOtp(h, u.phone);
    expect(await codeOf(h.recovery.resetPassword({ resetToken: otp, newPassword: 'newpass9' }))).toBe('RESET_TOKEN_INVALID');
    const { resetToken } = await h.recovery.verifyOtp({ phone: u.phone, otp });
    expect(await codeOf(h.recovery.verifyOtp({ phone: u.phone, otp: resetToken }))).toBe('OTP_INVALID');
  });
});

describe('resetPassword', () => {
  async function verified(h: ReturnType<typeof createRecoveryHarness>, phone: string) {
    const otp = await requestOtp(h, phone);
    return (await h.recovery.verifyOtp({ phone, otp })).resetToken;
  }

  it('changes the password, closes the recovery and revokes ALL sessions', async () => {
    const h = createRecoveryHarness();
    const u = await h.createUser();
    const session = await h.service.login({ phone: u.phone, password: u.password });
    const resetToken = await verified(h, u.phone);

    await h.recovery.resetPassword({ resetToken, newPassword: 'newpass9' });

    expect(await codeOf(h.service.login({ phone: u.phone, password: u.password }))).toBe('INVALID_CREDENTIALS');
    expect((await h.service.login({ phone: u.phone, password: 'newpass9' })).user.id).toBe(u.id);
    expect(await codeOf(h.service.authenticate(session.accessToken))).toBe('SESSION_REVOKED');
    expect(await codeOf(h.service.refresh(session.refreshToken))).toBe('SESSION_REVOKED');
    const sessions = [...h.sessionRepository.sessions.values()];
    expect(sessions.find((s) => s.id === sessions[0]!.id)?.revokedReason).toBe('PASSWORD_RESET');
    expect([...h.repository.recoveries.values()][0]).toMatchObject({ status: 'CONSUMED' });
  });

  it('is single use', async () => {
    const h = createRecoveryHarness();
    const u = await h.createUser();
    const resetToken = await verified(h, u.phone);
    await h.recovery.resetPassword({ resetToken, newPassword: 'newpass9' });
    expect(await codeOf(h.recovery.resetPassword({ resetToken, newPassword: 'another1' }))).toBe('RESET_TOKEN_INVALID');
    expect((await h.service.login({ phone: u.phone, password: 'newpass9' })).user.id).toBe(u.id);
  });

  it('expires after 10 minutes', async () => {
    const h = createRecoveryHarness();
    const u = await h.createUser();
    const resetToken = await verified(h, u.phone);
    h.advance(10 * MIN - 1000);
    const ok = createRecoveryHarness();
    const okUser = await ok.createUser();
    const okToken = await verified(ok, okUser.phone);
    ok.advance(10 * MIN - 1000);
    expect(await codeOf(ok.recovery.resetPassword({ resetToken: okToken, newPassword: 'newpass9' }))).toBe('OK');
    h.advance(1000);
    expect(await codeOf(h.recovery.resetPassword({ resetToken, newPassword: 'newpass9' }))).toBe('RESET_TOKEN_INVALID');
    expect(await codeOf(h.service.login({ phone: u.phone, password: 'newpass9' }))).toBe('INVALID_CREDENTIALS');
  });

  it('applies the 4-12 character password policy WITHOUT using up the token', async () => {
    const h = createRecoveryHarness();
    const u = await h.createUser();
    const resetToken = await verified(h, u.phone);
    for (const newPassword of ['123', 'x'.repeat(13), '', undefined, 1234]) {
      expect(await codeOf(h.recovery.resetPassword({ resetToken, newPassword }))).toBe('INVALID_PASSWORD');
    }
    expect(await codeOf(h.recovery.resetPassword({ resetToken, newPassword: 'abcd' }))).toBe('OK');
    expect((await h.service.login({ phone: u.phone, password: 'abcd' })).user.id).toBe(u.id);
  });

  it('rejects unknown, empty, oversized and non-string tokens', async () => {
    const h = createRecoveryHarness();
    for (const resetToken of ['nope', '', 'x'.repeat(201), undefined, null, 42, {}]) {
      expect(await codeOf(h.recovery.resetPassword({ resetToken, newPassword: 'newpass9' })), String(resetToken)).toBe('RESET_TOKEN_INVALID');
    }
  });

  it('binds the token to the user who verified the OTP', async () => {
    const h = createRecoveryHarness();
    const a = await h.createUser();
    const b = await h.createUser();
    const tokenA = await verified(h, a.phone);
    await verified(h, b.phone);

    await h.recovery.resetPassword({ resetToken: tokenA, newPassword: 'newpass9' });

    expect((await h.service.login({ phone: a.phone, password: 'newpass9' })).user.id).toBe(a.id);
    expect((await h.service.login({ phone: b.phone, password: b.password })).user.id).toBe(b.id); // B untouched
  });

  it('fails (and changes nothing) if the account was disabled after the OTP was verified', async () => {
    const h = createRecoveryHarness();
    const u = await h.createUser();
    const resetToken = await verified(h, u.phone);
    await h.identity.deactivateUser(u.id);
    expect(await codeOf(h.recovery.resetPassword({ resetToken, newPassword: 'newpass9' }))).toBe('RESET_TOKEN_INVALID');
    await h.identity.activateUser(u.id);
    expect(await codeOf(h.recovery.resetPassword({ resetToken, newPassword: 'newpass9' }))).toBe('RESET_TOKEN_INVALID'); // closed for good
    expect((await h.service.login({ phone: u.phone, password: u.password })).user.id).toBe(u.id);
  });

  it('a new request after verification invalidates the old reset token', async () => {
    const h = createRecoveryHarness();
    const u = await h.createUser();
    const resetToken = await verified(h, u.phone);
    h.advance(MIN);
    await requestOtp(h, u.phone);
    expect(await codeOf(h.recovery.resetPassword({ resetToken, newPassword: 'newpass9' }))).toBe('RESET_TOKEN_INVALID');
  });

  it('publishes PasswordResetCompleted and UserPasswordChanged, and no secret reaches the outbox', async () => {
    const h = createRecoveryHarness();
    const u = await h.createUser();
    const otp = await requestOtp(h, u.phone);
    const { resetToken } = await h.recovery.verifyOtp({ phone: u.phone, otp });
    await h.recovery.resetPassword({ resetToken, newPassword: 'newpass9' });

    const types = h.store.messages.map((m) => m.eventType);
    expect(types).toContain('PasswordResetCompleted');
    expect(types).toContain('UserPasswordChanged');
    const dump = JSON.stringify(h.store.messages);
    for (const secret of [otp, resetToken, 'newpass9']) expect(dump).not.toContain(secret);
  });
});
