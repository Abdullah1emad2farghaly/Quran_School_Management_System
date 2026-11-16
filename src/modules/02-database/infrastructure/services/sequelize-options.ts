import type { Options } from 'sequelize';
import type { AppConfig } from '../../../01-configuration/public';

/** All tables/connections use utf8mb4 so Arabic text is stored correctly (MariaDB/MySQL). */
export const DB_CHARSET = 'utf8mb4';
export const DB_COLLATION = 'utf8mb4_unicode_ci';

export interface ConnectionOverrides {
  readonly poolMax?: number;
}

const DEFAULT_POOL_MAX = 10;

/**
 * Pure builder for Sequelize options.
 * - timestamps are exchanged in UTC (business timezone conversion happens in the app)
 * - snake_case column names via `underscored`
 * - dialect "mysql" works with MariaDB 10.4 (XAMPP)
 */
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
    pool: { max: overrides.poolMax ?? DEFAULT_POOL_MAX, min: 0, acquire: 30_000, idle: 10_000 },
    dialectOptions: { charset: DB_COLLATION.toUpperCase() },
    define: { charset: DB_CHARSET, collate: DB_COLLATION, underscored: true },
  };
}
