import { describe, expect, it } from 'vitest';
import { DB_COLLATION, buildSequelizeOptions } from '../../../src/modules/02-database/public';

const db = { host: 'h', port: 3307, name: 'n', user: 'u', password: 'p' };

describe('buildSequelizeOptions', () => {
  it('targets MariaDB/MySQL with UTC timestamps and utf8mb4', () => {
    const o = buildSequelizeOptions(db);
    expect(o.dialect).toBe('mysql');
    expect(o.host).toBe('h');
    expect(o.port).toBe(3307);
    expect(o.timezone).toBe('+00:00');
    expect(o.define?.charset).toBe('utf8mb4');
    expect(o.define?.collate).toBe(DB_COLLATION);
    expect(o.define?.underscored).toBe(true);
    expect((o.dialectOptions as { charset: string }).charset).toBe('UTF8MB4_UNICODE_CI');
  });
  it('has a bounded default pool that can be overridden', () => {
    expect(buildSequelizeOptions(db).pool?.max).toBe(10);
    expect(buildSequelizeOptions(db, { poolMax: 1 }).pool?.max).toBe(1);
  });
  it('never logs SQL by default', () => {
    expect(buildSequelizeOptions(db).logging).toBe(false);
  });
});
