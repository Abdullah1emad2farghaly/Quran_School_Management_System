import { describe, expect, it } from 'vitest';
import { ConfigurationError, loadConfig, redactConfig } from '../../../src/modules/01-configuration/public';

const strong = (c: string) => c.repeat(40);
const prod = {
  NODE_ENV: 'production',
  DATABASE_NAME: 'db',
  DATABASE_USER: 'u',
  DATABASE_PASSWORD: 'p',
  JWT_ACCESS_SECRET: strong('a'),
  JWT_REFRESH_SECRET: strong('b'),
  OTP_HMAC_SECRET: strong('c'),
};

function issuesOf(source: Record<string, string>): readonly string[] {
  try {
    loadConfig(source);
  } catch (e) {
    if (e instanceof ConfigurationError) return e.issues;
    throw e;
  }
  return [];
}

describe('OTP configuration', () => {
  it('defaults to no delivery and an unset secret outside production', () => {
    const c = loadConfig({});
    expect(c.otp).toEqual({ hmacSecret: '', sender: 'disabled' });
  });

  it('requires a dedicated, long OTP_HMAC_SECRET in production', () => {
    const { OTP_HMAC_SECRET: _omit, ...withoutOtp } = prod;
    expect(issuesOf(withoutOtp)).toEqual(['OTP_HMAC_SECRET: required in production']);
    expect(issuesOf({ ...prod, OTP_HMAC_SECRET: 'short' })).toHaveLength(1);
  });

  it('refuses to reuse a JWT secret as the OTP secret', () => {
    expect(issuesOf({ ...prod, OTP_HMAC_SECRET: prod.JWT_REFRESH_SECRET })).toEqual(['OTP_HMAC_SECRET: must be different from the JWT secrets']);
    expect(issuesOf({ ...prod, OTP_HMAC_SECRET: prod.JWT_ACCESS_SECRET })).toHaveLength(1);
  });

  it('allows the development file sender only outside production', () => {
    expect(loadConfig({ OTP_SENDER: 'dev-file' }).otp.sender).toBe('dev-file');
    expect(issuesOf({ ...prod, OTP_SENDER: 'dev-file' })).toHaveLength(1);
    expect(loadConfig({ ...prod, OTP_SENDER: 'disabled' }).otp.sender).toBe('disabled');
  });

  it('rejects unknown senders', () => {
    expect(issuesOf({ OTP_SENDER: 'carrier-pigeon' })).toHaveLength(1);
  });

  it('masks the OTP secret and never puts it in error messages', () => {
    const c = loadConfig({ OTP_HMAC_SECRET: 'super-secret-otp' });
    expect(redactConfig(c).otp.hmacSecret).toBe('[REDACTED]');
    expect(JSON.stringify(redactConfig(c))).not.toContain('super-secret-otp');
    let message = '';
    try {
      loadConfig({ ...prod, OTP_HMAC_SECRET: 'topsecretotp' });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).not.toContain('topsecretotp');
    expect(message).toContain('OTP_HMAC_SECRET');
  });
});

describe('TRUSTED_PROXIES', () => {
  it('trusts nobody by default', () => {
    expect(loadConfig({}).http.trustedProxies).toEqual([]);
    expect(loadConfig({ TRUSTED_PROXIES: '' }).http.trustedProxies).toEqual([]);
  });

  it('accepts explicit IPs, CIDR ranges and named ranges', () => {
    const c = loadConfig({ TRUSTED_PROXIES: '10.0.0.5, 192.168.0.0/16 ,2001:db8::/32, loopback' });
    expect(c.http.trustedProxies).toEqual(['10.0.0.5', '192.168.0.0/16', '2001:db8::/32', 'loopback']);
  });

  it.each(['true', '*', '1', '2', 'all', '0.0.0.0/0', '::/0', '10.0.0.0/33', '10.0.0.0/x', '10.0.0.0/8/8', 'example.com', '999.1.1.1'])(
    'rejects %j (it would trust forged forwarding headers or is not an address)',
    (value) => {
      expect(issuesOf({ TRUSTED_PROXIES: value })).toHaveLength(1);
    },
  );
});
