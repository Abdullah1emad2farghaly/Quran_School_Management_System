import { describe, expect, it } from 'vitest';
import { ConfigurationError, loadConfig } from '../../../src/modules/01-configuration/public';

const strong = (c: string) => c.repeat(40);
const prod = {
  NODE_ENV: 'production',
  DATABASE_NAME: 'db',
  DATABASE_USER: 'u',
  DATABASE_PASSWORD: 'p',
  JWT_ACCESS_SECRET: strong('a'),
  JWT_REFRESH_SECRET: strong('b'),
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

describe('loadConfig defaults', () => {
  it('loads sensible defaults for an empty environment', () => {
    const c = loadConfig({});
    expect(c.nodeEnv).toBe('development');
    expect(c.port).toBe(3000);
    expect(c.timezone).toBe('Africa/Cairo');
    expect(c.defaultLocale).toBe('ar');
    expect(c.database.port).toBe(3306);
    expect(c.redis.port).toBe(6379);
    expect(c.files.maxFileSize).toBe(10 * 1024 * 1024);
    expect(c.corsOrigins).toEqual([]);
  });
  it('treats blank values as unset and trims', () => {
    const c = loadConfig({ PORT: '  ', APP_TIMEZONE: ' Africa/Cairo ' });
    expect(c.port).toBe(3000);
    expect(c.timezone).toBe('Africa/Cairo');
  });
  it('returns an immutable object', () => {
    const c = loadConfig({});
    expect(Object.isFrozen(c)).toBe(true);
    expect(Object.isFrozen(c.database)).toBe(true);
  });
});

describe('log level', () => {
  it('defaults to info, and to silent in test', () => {
    expect(loadConfig({}).logLevel).toBe('info');
    expect(loadConfig({ NODE_ENV: 'test' }).logLevel).toBe('silent');
    expect(loadConfig(prod).logLevel).toBe('info');
  });
  it('accepts an explicit level and rejects invalid ones', () => {
    expect(loadConfig({ LOG_LEVEL: 'debug' }).logLevel).toBe('debug');
    expect(issuesOf({ LOG_LEVEL: 'verbose' })).toHaveLength(1);
  });
});

describe('loadConfig validation', () => {
  it('rejects invalid values and reports all issues at once', () => {
    const issues = issuesOf({ NODE_ENV: 'staging', PORT: 'abc', DEFAULT_LOCALE: 'fr', APP_TIMEZONE: 'Mars/Base' });
    expect(issues).toHaveLength(4);
  });
  it('validates port ranges', () => {
    expect(issuesOf({ PORT: '0' })).toHaveLength(1);
    expect(issuesOf({ PORT: '70000' })).toHaveLength(1);
    expect(issuesOf({ PORT: '8080' })).toHaveLength(0);
  });
  it('validates CORS origins', () => {
    expect(loadConfig({ CORS_ORIGINS: 'http://localhost:5173, https://app.example.com' }).corsOrigins).toEqual([
      'http://localhost:5173',
      'https://app.example.com',
    ]);
    expect(issuesOf({ CORS_ORIGINS: '*' })).toHaveLength(1);
    expect(issuesOf({ CORS_ORIGINS: 'http://localhost:5173/' })).toHaveLength(1);
    expect(issuesOf({ CORS_ORIGINS: 'localhost:5173' })).toHaveLength(1);
  });
  it('requires a positive integer MAX_FILE_SIZE', () => {
    expect(issuesOf({ MAX_FILE_SIZE: '0' })).toHaveLength(1);
    expect(issuesOf({ MAX_FILE_SIZE: '-5' })).toHaveLength(1);
  });
});

describe('loadConfig production rules', () => {
  it('accepts a complete production configuration', () => {
    expect(loadConfig(prod).nodeEnv).toBe('production');
  });
  it('requires database settings and secrets', () => {
    expect(issuesOf({ NODE_ENV: 'production' })).toHaveLength(5);
  });
  it('rejects short secrets', () => {
    expect(issuesOf({ ...prod, JWT_ACCESS_SECRET: 'short' })).toHaveLength(1);
  });
  it('rejects identical access and refresh secrets', () => {
    expect(issuesOf({ ...prod, JWT_REFRESH_SECRET: prod.JWT_ACCESS_SECRET })).toHaveLength(1);
  });
  it('does not require secrets outside production', () => {
    expect(issuesOf({ NODE_ENV: 'development' })).toHaveLength(0);
    expect(issuesOf({ NODE_ENV: 'test' })).toHaveLength(0);
  });
  it('never includes secret values in error messages', () => {
    const secret = 'topsecretvalue';
    let message = '';
    try {
      loadConfig({ ...prod, JWT_ACCESS_SECRET: secret });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message.includes(secret)).toBe(false);
    expect(message.includes('JWT_ACCESS_SECRET')).toBe(true);
  });
});
