'use strict';
const { TABLE_OPTIONS, uuidPrimaryKey, auditTimestamps } = require('../helpers.cjs');

/**
 * Module 08 (Identity Core): the login identity.
 * - phone: normalized E.164, globally unique (Master Specification §21).
 * - password_hash: bcrypt hash only; plaintext is never stored (§23, §86).
 * - status: ACTIVE | INACTIVE (§22). Rows are never deleted, so history is preserved.
 * - version: optimistic-lock counter.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable(
      'users',
      {
        id: uuidPrimaryKey(Sequelize),
        phone: { type: Sequelize.STRING(16), allowNull: false },
        password_hash: { type: Sequelize.STRING(100), allowNull: false },
        status: { type: Sequelize.STRING(16), allowNull: false, defaultValue: 'ACTIVE' },
        status_changed_at: { type: Sequelize.DATE(3), allowNull: false },
        version: { type: Sequelize.INTEGER.UNSIGNED, allowNull: false, defaultValue: 1 },
        ...auditTimestamps(Sequelize),
      },
      TABLE_OPTIONS,
    );
    await queryInterface.addIndex('users', ['phone'], { unique: true, name: 'uq_users_phone' });
    await queryInterface.addIndex('users', ['status'], { name: 'ix_users_status' });
    await queryInterface.sequelize.query(
      "ALTER TABLE users ADD CONSTRAINT ck_users_status CHECK (status IN ('ACTIVE','INACTIVE'))",
    );
  },

  async down(queryInterface) {
    await queryInterface.dropTable('users');
  },
};
