import type { Sequelize } from 'sequelize';
import type { UnitOfWork } from '../modules/00-shared-kernel/public';
import {
  SequelizeUnitOfWork,
  checkConnection,
  createSequelize,
} from '../modules/02-database/public';
import { env } from './env';

let instance: Sequelize | undefined;
let unitOfWork: UnitOfWork | undefined;

/** Lazily creates the single Sequelize connection pool. */
export function getSequelize(): Sequelize {
  if (!instance) instance = createSequelize(env.database);
  return instance;
}

/** The application-wide UnitOfWork (inject it into use cases). */
export function getUnitOfWork(): UnitOfWork {
  if (!unitOfWork) unitOfWork = new SequelizeUnitOfWork(getSequelize());
  return unitOfWork;
}

export async function checkDatabase(): Promise<boolean> {
  return checkConnection(getSequelize());
}

export async function closeDatabase(): Promise<void> {
  if (instance) {
    await instance.close();
    instance = undefined;
    unitOfWork = undefined;
  }
}
