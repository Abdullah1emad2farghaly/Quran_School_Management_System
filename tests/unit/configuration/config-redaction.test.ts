import { describe, expect, it } from 'vitest';
import { loadConfig, redactConfig } from '../../../src/modules/01-configuration/public';

describe('redactConfig', () => {
  it('masks passwords and secrets but keeps other fields', () => {
    const c = loadConfig({ DATABASE_PASSWORD: 'dbpass', JWT_ACCESS_SECRET: 'abc', PORT: '4000' });
    const r = redactConfig(c);
    expect(r.database.password).toBe('[REDACTED]');
    expect(r.jwt.accessSecret).toBe('[REDACTED]');
    expect(r.jwt.refreshSecret).toBe('[UNSET]');
    expect(r.port).toBe(4000);
    expect(JSON.stringify(r).includes('dbpass')).toBe(false);
  });
});
