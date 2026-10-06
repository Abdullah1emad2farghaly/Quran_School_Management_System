import { Sequelize } from 'sequelize';
import type { AppConfig } from '../../../01-configuration/public';
import { buildSequelizeOptions, type ConnectionOverrides } from './sequelize-options';

export function createSequelize(db: AppConfig['database'], overrides?: ConnectionOverrides): Sequelize {
  return new Sequelize(db.name, db.user, db.password, buildSequelizeOptions(db, overrides));
}

export async function checkConnection(sequelize: Pick<Sequelize, 'authenticate'>): Promise<boolean> {
  try {
    await sequelize.authenticate();
    return true;
  } catch {
    return false;
  }
}
