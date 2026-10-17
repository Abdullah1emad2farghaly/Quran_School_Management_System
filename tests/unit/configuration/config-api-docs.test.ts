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
  OTP_HMAC_SECRET: strong('c'),
};

describe('API documentation switch (API_DOCS_ENABLED)', () => {
  it('is enabled by default in development and test', () => {
    expect(loadConfig({}).apiDocs.enabled).toBe(true);
    expect(loadConfig({ NODE_ENV: 'development' }).apiDocs.enabled).toBe(true);
    expect(loadConfig({ NODE_ENV: 'test' }).apiDocs.enabled).toBe(true);
  });

  it('is disabled by default in production', () => {
    expect(loadConfig(prod).apiDocs.enabled).toBe(false);
  });

  it('can be enabled explicitly in production and disabled explicitly elsewhere', () => {
    expect(loadConfig({ ...prod, API_DOCS_ENABLED: 'true' }).apiDocs.enabled).toBe(true);
    expect(loadConfig({ API_DOCS_ENABLED: 'false' }).apiDocs.enabled).toBe(false);
  });

  it('treats an empty value as unset', () => {
    expect(loadConfig({ API_DOCS_ENABLED: '' }).apiDocs.enabled).toBe(true);
    expect(loadConfig({ ...prod, API_DOCS_ENABLED: '  ' }).apiDocs.enabled).toBe(false);
  });

  it('rejects anything but "true" or "false"', () => {
    for (const bad of ['1', 'yes', 'TRUE', 'on']) {
      try {
        loadConfig({ API_DOCS_ENABLED: bad });
        throw new Error('expected a ConfigurationError');
      } catch (e) {
        expect(e).toBeInstanceOf(ConfigurationError);
        expect((e as ConfigurationError).issues).toEqual(['API_DOCS_ENABLED: must be "true" or "false"']);
      }
    }
  });
});
