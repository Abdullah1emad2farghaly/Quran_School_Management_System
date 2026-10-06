/**
 * Shared conventions for migrations (MariaDB 10.4 / MySQL, utf8mb4).
 * Usage in a migration:
 *   const { TABLE_OPTIONS, uuidPrimaryKey, auditTimestamps } = require('../helpers.cjs');
 *   await queryInterface.createTable('things', {
 *     id: uuidPrimaryKey(Sequelize),
 *     ...auditTimestamps(Sequelize),
 *   }, TABLE_OPTIONS);
 */
const TABLE_OPTIONS = {
  engine: 'InnoDB',
  charset: 'utf8mb4',
  collate: 'utf8mb4_unicode_ci',
};

/** UUID stored as CHAR(36) (MariaDB 10.4 has no native UUID type). */
const uuidColumn = (Sequelize, overrides = {}) => ({
  type: Sequelize.CHAR(36),
  allowNull: false,
  ...overrides,
});

const uuidPrimaryKey = (Sequelize) => uuidColumn(Sequelize, { primaryKey: true });

/** created_at / updated_at as DATETIME(3), stored in UTC. */
const auditTimestamps = (Sequelize) => ({
  created_at: { type: Sequelize.DATE(3), allowNull: false },
  updated_at: { type: Sequelize.DATE(3), allowNull: false },
});

module.exports = { TABLE_OPTIONS, uuidColumn, uuidPrimaryKey, auditTimestamps };
