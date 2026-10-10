import { Sequelize } from 'sequelize';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSequelize, toUtcSqlDate, withUtcReplacements } from '../../../src/modules/02-database/public';

// Sequelize's own formatter, used by sequelize.query() for `replacements`.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { formatNamedParameters } = require('sequelize/lib/utils') as {
  formatNamedParameters: (sql: string, params: Record<string, unknown>, dialect: string) => string;
};

const db = { host: 'h', port: 3307, name: 'n', user: 'u', password: 'p' };
const INSTANT = new Date('2026-10-09T10:00:00.123Z');
const originalTz = process.env.TZ;
afterEach(() => {
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
  vi.restoreAllMocks();
});

describe('toUtcSqlDate', () => {
  it('formats the instant in UTC with milliseconds', () => {
    expect(toUtcSqlDate(INSTANT)).toBe('2026-10-09 10:00:00.123');
    expect(toUtcSqlDate(new Date('2026-11-08T00:00:00Z'))).toBe('2026-11-08 00:00:00.000');
  });

  it('does not depend on the process time zone', () => {
    for (const tz of ['UTC', 'Africa/Cairo', 'America/New_York', 'Asia/Kolkata']) {
      process.env.TZ = tz;
      expect(toUtcSqlDate(INSTANT), tz).toBe('2026-10-09 10:00:00.123');
    }
  });
});

describe('the Sequelize behaviour this protects against', () => {
  it('formats a raw Date in LOCAL time (so a non-UTC server would write shifted timestamps)', () => {
    process.env.TZ = 'Africa/Cairo';
    const sql = formatNamedParameters('SELECT :d', { d: INSTANT }, 'mysql');
    expect(sql).toContain('2026-10-09 13:00:00'); // Cairo is UTC+3 on that date: a 3-hour shift (and no milliseconds)
  });

  it('writes UTC once the replacements go through withUtcReplacements, on any server time zone', () => {
    for (const tz of ['UTC', 'Africa/Cairo']) {
      process.env.TZ = tz;
      const options = withUtcReplacements({ replacements: { d: INSTANT } });
      const sql = formatNamedParameters('SELECT :d', options.replacements, 'mysql');
      expect(sql, tz).toContain('2026-10-09 10:00:00.123');
    }
  });

  it('keeps a 30-day span exact across the Cairo daylight-saving change', () => {
    process.env.TZ = 'Africa/Cairo';
    const issued = new Date('2026-10-09T10:00:00.000Z');
    const expires = new Date(issued.getTime() + 30 * 24 * 3600 * 1000);
    const a = toUtcSqlDate(issued);
    const b = toUtcSqlDate(expires);
    expect(new Date(`${b.replace(' ', 'T')}Z`).getTime() - new Date(`${a.replace(' ', 'T')}Z`).getTime()).toBe(30 * 24 * 3600 * 1000);
  });
});

describe('withUtcReplacements', () => {
  it('converts Dates in named and positional replacements, including arrays, and leaves everything else alone', () => {
    expect(withUtcReplacements({ replacements: { a: INSTANT, b: 'x', c: 5, d: null, e: [INSTANT, 1] } })).toEqual({
      replacements: { a: '2026-10-09 10:00:00.123', b: 'x', c: 5, d: null, e: ['2026-10-09 10:00:00.123', 1] },
    });
    expect(withUtcReplacements({ replacements: [INSTANT, 'x'] })).toEqual({ replacements: ['2026-10-09 10:00:00.123', 'x'] });
  });

  it('keeps the other options and does not touch options without replacements', () => {
    const tx = { id: 1 };
    expect(withUtcReplacements({ transaction: tx, replacements: { a: INSTANT } })).toEqual({
      transaction: tx,
      replacements: { a: '2026-10-09 10:00:00.123' },
    });
    expect(withUtcReplacements({ type: 'SELECT' })).toEqual({ type: 'SELECT' });
    expect(withUtcReplacements(undefined)).toBeUndefined();
  });

  it('does not mutate the caller\'s options', () => {
    const replacements = { a: INSTANT };
    withUtcReplacements({ replacements });
    expect(replacements.a).toBe(INSTANT);
  });
});

describe('createSequelize', () => {
  it('sends Date replacements to Sequelize as UTC strings', async () => {
    const spy = vi.spyOn(Sequelize.prototype, 'query').mockResolvedValue([] as never);
    const sequelize = createSequelize(db);
    await sequelize.query('SELECT :at', { replacements: { at: INSTANT } });
    expect(spy).toHaveBeenCalledWith('SELECT :at', { replacements: { at: '2026-10-09 10:00:00.123' } });
    await sequelize.query('SELECT 1');
    expect(spy).toHaveBeenLastCalledWith('SELECT 1', undefined);
  });
});
