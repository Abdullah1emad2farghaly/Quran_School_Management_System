import { Sequelize } from 'sequelize';
import type { AppConfig } from '../../../01-configuration/public';
import { buildSequelizeOptions, type ConnectionOverrides } from './sequelize-options';
import { installUtcReplacements } from './utc-replacements';

export function createSequelize(db: AppConfig['database'], overrides?: ConnectionOverrides): Sequelize {
  const sequelize = new Sequelize(db.name, db.user, db.password, buildSequelizeOptions(db, overrides));
  installUtcReplacements(sequelize); // timestamps are always written in UTC, whatever the server's time zone
  return sequelize;
}

export async function checkConnection(sequelize: Pick<Sequelize, 'authenticate'>): Promise<boolean> {
  try {
    await sequelize.authenticate();
    return true;
  } catch {
    return false;
  }
}
