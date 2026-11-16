import { describe, expect, it } from 'vitest';
import { ConfigurationError, loadConfig, redactConfig } from '../../../src/modules/01-configuration/public';

const PUBLIC_KEY = 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U';
const PRIVATE_KEY = 'UUxI4O8-FbRouAevSmBQ6o18hgE4nSG3qwvJTfKc-ls';
const good = { VAPID_PUBLIC_KEY: PUBLIC_KEY, VAPID_PRIVATE_KEY: PRIVATE_KEY, VAPID_SUBJECT: 'mailto:admin@example.com' };

function issuesOf(source: Record<string, string>): readonly string[] {
  try {
    loadConfig(source);
  } catch (e) {
    if (e instanceof ConfigurationError) return e.issues;
    throw e;
  }
  return [];
}

describe('Web Push (VAPID) configuration', () => {
  it('is disabled when nothing is configured (in-app notifications still work)', () => {
    expect(loadConfig({}).push).toEqual({ enabled: false, vapidPublicKey: '', vapidPrivateKey: '', vapidSubject: '' });
  });

  it('is enabled when all three settings are valid (mailto or https subject)', () => {
    expect(loadConfig(good).push).toEqual({ enabled: true, vapidPublicKey: PUBLIC_KEY, vapidPrivateKey: PRIVATE_KEY, vapidSubject: 'mailto:admin@example.com' });
    expect(loadConfig({ ...good, VAPID_SUBJECT: 'https://school.example.com' }).push.enabled).toBe(true);
  });

  it('refuses a partial configuration instead of silently running without push', () => {
    expect(issuesOf({ VAPID_PUBLIC_KEY: PUBLIC_KEY })).toHaveLength(1);
    expect(issuesOf({ VAPID_PUBLIC_KEY: PUBLIC_KEY, VAPID_PRIVATE_KEY: PRIVATE_KEY })).toHaveLength(1);
    expect(issuesOf({ VAPID_SUBJECT: 'mailto:a@b.co' })[0]).toMatch(/all three, or none/);
  });

  it('validates the keys and the subject', () => {
    expect(issuesOf({ ...good, VAPID_PUBLIC_KEY: 'not a key!' }).join(' ')).toMatch(/VAPID_PUBLIC_KEY/);
    expect(issuesOf({ ...good, VAPID_PRIVATE_KEY: 'short' }).join(' ')).toMatch(/VAPID_PRIVATE_KEY/);
    expect(issuesOf({ ...good, VAPID_SUBJECT: 'admin@example.com' }).join(' ')).toMatch(/VAPID_SUBJECT/);
    expect(issuesOf({ ...good, VAPID_SUBJECT: 'http://insecure.example.com' }).join(' ')).toMatch(/VAPID_SUBJECT/);
  });

  it('never reveals the private key in the redacted (loggable) configuration or in an error message', () => {
    const redacted = redactConfig(loadConfig(good));
    expect(redacted.push.vapidPrivateKey).toBe('[REDACTED]');
    expect(JSON.stringify(redacted)).not.toContain(PRIVATE_KEY);
    expect(issuesOf({ ...good, VAPID_PRIVATE_KEY: `${PRIVATE_KEY}!!` }).join(' ')).not.toContain(PRIVATE_KEY);
    expect(redactConfig(loadConfig({})).push.vapidPrivateKey).toBe('[UNSET]');
  });
});
