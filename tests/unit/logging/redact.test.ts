import { describe, expect, it } from 'vitest';
import { REDACTED, isSensitiveKey, redact, sanitizeString } from '../../../src/modules/05-logging-request-context/public';

type Obj = Record<string, unknown>;

describe('isSensitiveKey', () => {
  it('flags passwords, tokens, secrets, OTPs and auth data in any naming style', () => {
    for (const k of ['password', 'newPassword', 'current_password', 'refreshToken', 'access-token', 'JWT_ACCESS_SECRET',
      'authorization', 'Cookie', 'otp', 'otpCode', 'smsOtp', 'apiKey', 'privateKey']) {
      expect(isSensitiveKey(k)).toBe(true);
    }
  });
  it('does not flag ordinary fields', () => {
    for (const k of ['name', 'status', 'requestId', 'studentId', 'path']) expect(isSensitiveKey(k)).toBe(false);
  });
});

describe('redact', () => {
  it('masks sensitive keys at any depth without mutating the input', () => {
    const input = { user: { name: 'Ali', password: 'p@ss', nested: { refreshToken: 'abc' } }, list: [{ otp: '123456' }] };
    const out = redact(input) as { user: { name: string; password: string; nested: Obj }; list: Obj[] };
    expect(out.user.name).toBe('Ali');
    expect(out.user.password).toBe(REDACTED);
    expect(out.user.nested.refreshToken).toBe(REDACTED);
    expect(out.list[0]?.otp).toBe(REDACTED);
    expect(input.user.password).toBe('p@ss');
  });
  it('scrubs JWTs, Bearer tokens and URL credentials inside strings', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.c2lnbmF0dXJl';
    expect(sanitizeString(`token was ${jwt} ok`).includes('eyJ')).toBe(false);
    expect(sanitizeString('Authorization: Bearer abc.def-123')).toBe('Authorization: Bearer [REDACTED]');
    expect(sanitizeString('mysql://root:hunter2@localhost/db')).toBe('mysql://root:[REDACTED]@localhost/db');
  });
  it('serializes errors with code and kind, and sanitizes the message', () => {
    class E extends Error { code = 'SOME_CODE'; kind = 'INTERNAL'; }
    const out = redact(new E('failed with Bearer secret123')) as Obj;
    expect(out.name).toBe('Error');
    expect(out.code).toBe('SOME_CODE');
    expect(out.kind).toBe('INTERNAL');
    expect(String(out.message).includes('secret123')).toBe(false);
    expect(typeof out.stack).toBe('string');
  });
  it('handles circular references, depth, long arrays and long strings', () => {
    const a: Obj = { name: 'a' };
    a.self = a;
    expect((redact(a) as Obj).self).toBe('[Circular]');
    let deep: Obj = {};
    const root = deep;
    for (let i = 0; i < 10; i++) { const next: Obj = {}; deep.n = next; deep = next; }
    expect(JSON.stringify(redact(root)).includes('[MaxDepth]')).toBe(true);
    expect((redact(new Array(80).fill(1)) as unknown[]).length).toBe(51);
    expect(String(redact('x'.repeat(5000))).length < 2100).toBe(true);
  });
  it('converts non-JSON values safely', () => {
    const out = redact({ big: 10n, d: new Date('2026-01-01T00:00:00Z'), f: () => 1, buf: Buffer.from('x'), m: new Map() }) as Obj;
    expect(out.big).toBe('10');
    expect(out.d).toBe('2026-01-01T00:00:00.000Z');
    expect(out.f).toBe('[Function]');
    expect(out.buf).toBe('[Binary]');
    expect(out.m).toBe('[Map]');
  });
});
