
import type { Options } from 'sequelize';
import type { AppConfig } from '../../../01-configuration/public';

export const DB_CHARSET = 'utf8mb4';
export const DB_COLLATION = 'utf8mb4_unicode_ci';

export interface ConnectionOverrides {
  readonly poolMax?: number;
}

const DEFAULT_POOL_MAX = 10;

export function buildSequelizeOptions(
  db: AppConfig['database'],
  overrides: ConnectionOverrides = {},
): Options {
  return {
    dialect: 'mysql',
    host: db.host,
    port: db.port,
    timezone: '+00:00',
    logging: false,
    pool: {
      max: overrides.poolMax ?? DEFAULT_POOL_MAX,
      min: 0,
      acquire: 30_000,
      idle: 10_000,
    },
    dialectOptions: {
      charset: DB_COLLATION.toUpperCase(),
      ssl: {
        rejectUnauthorized: true,
      },
    },
    define: {
      charset: DB_CHARSET,
      collate: DB_COLLATION,
      underscored: true,
    },
  };
}
