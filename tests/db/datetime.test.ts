/**
 * Real-database check that timestamps round-trip exactly whatever the Node process' time zone is.
 * (Sequelize formats Date replacements in LOCAL time; Module 02 forces UTC.) Uses a TEMPORARY table, so it
 * leaves nothing behind. NOT part of `npm test`. Run: npm run test:db
 */
import { QueryTypes } from 'sequelize';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { env } from '../../src/config/env';
import { createSequelize } from '../../src/modules/02-database/public';

const sequelize = createSequelize(env.database, { poolMax: 2 });
const originalTz = process.env.TZ;

afterEach(() => {
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});
afterAll(() => sequelize.close());

describe('timestamps (MariaDB)', () => {
  for (const tz of ['UTC', 'Africa/Cairo', 'America/New_York']) {
    it(`store and return the same instant when the server time zone is ${tz}`, async () => {
      process.env.TZ = tz;
      const issued = new Date('2026-10-09T10:00:00.123Z');
      const expires = new Date(issued.getTime() + 30 * 24 * 3600 * 1000); // crosses the Cairo DST change

      await sequelize.transaction(async (transaction) => {
        // A temporary table lives as long as its CONNECTION (not the transaction), and the pool reuses connections.
        await sequelize.query('DROP TEMPORARY TABLE IF EXISTS tz_check', { transaction });
        await sequelize.query('CREATE TEMPORARY TABLE tz_check (id INT PRIMARY KEY, issued_at DATETIME(3), expires_at DATETIME(3))', { transaction });
        await sequelize.query('INSERT INTO tz_check VALUES (1, :issued, :expires)', { replacements: { issued, expires }, transaction });

        const [row] = await sequelize.query<{ issued_at: Date; expires_at: Date; raw: string }>(
          `SELECT issued_at, expires_at, DATE_FORMAT(issued_at, '%Y-%m-%d %H:%i:%s.%f') AS raw FROM tz_check WHERE id = 1`,
          { type: QueryTypes.SELECT, transaction },
        );
        expect(row!.raw).toBe('2026-10-09 10:00:00.123000'); // stored as UTC wall time with milliseconds
        expect(new Date(row!.issued_at).getTime()).toBe(issued.getTime());
        expect(new Date(row!.expires_at).getTime()).toBe(expires.getTime());
        expect(new Date(row!.expires_at).getTime() - new Date(row!.issued_at).getTime()).toBe(30 * 24 * 3600 * 1000);
        await sequelize.query('DROP TEMPORARY TABLE IF EXISTS tz_check', { transaction });
      });
    });
  }
});
