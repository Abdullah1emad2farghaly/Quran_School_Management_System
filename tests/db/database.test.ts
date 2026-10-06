/**
 * Real-database checks (MariaDB via XAMPP). NOT part of `npm test`.
 * Run with: npm run test:db   (requires the DB from your .env to exist).
 * Uses a TEMPORARY table on a single pooled connection; nothing persists.
 */
import { QueryTypes } from 'sequelize';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { env } from '../../src/config/env';
import {
  SequelizeUnitOfWork,
  checkConnection,
  createSequelize,
  sequelizeTransactionOf,
} from '../../src/modules/02-database/public';

const sequelize = createSequelize(env.database, { poolMax: 1 });
const uow = new SequelizeUnitOfWork(sequelize);

async function count(id: number): Promise<number> {
  const rows = await sequelize.query<{ n: number }>('SELECT COUNT(*) AS n FROM uow_probe WHERE id = :id', {
    replacements: { id },
    type: QueryTypes.SELECT,
  });
  return Number(rows[0]?.n);
}

describe('database (MariaDB)', () => {
  beforeAll(async () => {
    await sequelize.query(
      'CREATE TEMPORARY TABLE uow_probe (id INT PRIMARY KEY, label VARCHAR(100)) ' +
        'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci',
    );
  });
  afterAll(async () => {
    await sequelize.close();
  });

  const insert = (ctx: Parameters<typeof sequelizeTransactionOf>[0], id: number, label: string) =>
    sequelize.query('INSERT INTO uow_probe (id, label) VALUES (:id, :label)', {
      replacements: { id, label },
      transaction: sequelizeTransactionOf(ctx),
    });

  it('connects', async () => {
    expect(await checkConnection(sequelize)).toBe(true);
  });

  it('uses utf8mb4 on the connection', async () => {
    const rows = await sequelize.query<{ cs: string }>('SELECT @@character_set_connection AS cs', {
      type: QueryTypes.SELECT,
    });
    expect(rows[0]?.cs).toBe('utf8mb4');
  });

  it('commits on success', async () => {
    await uow.run(async (ctx) => {
      await insert(ctx, 1, 'committed');
    });
    expect(await count(1)).toBe(1);
  });

  it('rolls back on error', async () => {
    try {
      await uow.run(async (ctx) => {
        await insert(ctx, 2, 'rolled back');
        throw new Error('fail');
      });
    } catch {
      /* expected */
    }
    expect(await count(2)).toBe(0);
  });

  it('rolls back nested work together with the outer transaction', async () => {
    try {
      await uow.run(async (outer) => {
        await uow.run(async (inner) => {
          expect(inner === outer).toBe(true);
          await insert(inner, 3, 'nested');
        });
        throw new Error('fail after nested');
      });
    } catch {
      /* expected */
    }
    expect(await count(3)).toBe(0);
  });

  it('round-trips Arabic text', async () => {
    const text = 'مدرسة القرآن الكريم';
    await uow.run(async (ctx) => {
      await insert(ctx, 4, text);
    });
    const rows = await sequelize.query<{ label: string }>('SELECT label FROM uow_probe WHERE id = 4', {
      type: QueryTypes.SELECT,
    });
    expect(rows[0]?.label).toBe(text);
  });
});
