'use strict';
const { TABLE_OPTIONS, uuidColumn, auditTimestamps } = require('../helpers.cjs');

/**
 * Module 12 (Authorization Engine): the lock row used by the one-time first-Main-Admin bootstrap.
 * - Exactly one row (id = 1, enforced by a CHECK). The bootstrap does SELECT ... FOR UPDATE on it inside its transaction,
 *   so two concurrent bootstraps are serialized and the second one sees the first one's Main Admin and refuses.
 * - last_bootstrap_user_id / last_bootstrapped_at: operational trace of the last successful run. No secrets are stored.
 * The table is never used for authorization decisions; roles stay in `user_roles` (Module 09).
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable(
      'authorization_bootstrap_lock',
      {
        id: { type: Sequelize.TINYINT.UNSIGNED, allowNull: false, primaryKey: true },
        last_bootstrap_user_id: uuidColumn(Sequelize, { allowNull: true }),
        last_bootstrapped_at: { type: Sequelize.DATE(3), allowNull: true },
        ...auditTimestamps(Sequelize),
      },
      TABLE_OPTIONS,
    );
    await queryInterface.sequelize.query(
      'ALTER TABLE authorization_bootstrap_lock ADD CONSTRAINT ck_authorization_bootstrap_lock_single CHECK (id = 1)',
    );
    await queryInterface.sequelize.query(
      'INSERT INTO authorization_bootstrap_lock (id, created_at, updated_at) VALUES (1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))',
    );
  },

  async down(queryInterface) {
    await queryInterface.dropTable('authorization_bootstrap_lock');
  },
};
