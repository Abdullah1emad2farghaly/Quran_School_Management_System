// Public contract of Module 02 (Database & Transaction Infrastructure).
// Domain/application layers of other modules use the UnitOfWork PORT from the
// Shared Kernel. The exports below are for composition roots and for other
// modules' *infrastructure* layers only.
export { SequelizeUnitOfWork, type TransactionRunner } from '../infrastructure/services/sequelize-unit-of-work';
export { sequelizeTransactionOf } from '../infrastructure/services/sequelize-transaction-context';
export { createSequelize, checkConnection } from '../infrastructure/services/sequelize-connection';
export {
  buildSequelizeOptions,
  DB_CHARSET,
  DB_COLLATION,
  type ConnectionOverrides,
} from '../infrastructure/services/sequelize-options';
