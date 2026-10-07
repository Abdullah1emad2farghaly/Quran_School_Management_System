'use strict';
const { TABLE_OPTIONS, auditTimestamps, uuidColumn, uuidPrimaryKey } = require('../helpers.cjs');

/**
 * Metadata of privately stored files (V1: Excel .xlsx only).
 * There is intentionally no "public" column: files are private by default and
 * are only reachable through authorized application code.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable(
      'stored_files',
      {
        id: uuidPrimaryKey(Sequelize),
        original_name: { type: Sequelize.STRING(255), allowNull: false },
        storage_key: { type: Sequelize.STRING(255), allowNull: false },
        extension: { type: Sequelize.STRING(10), allowNull: false },
        mime_type: { type: Sequelize.STRING(150), allowNull: false },
        size_bytes: { type: Sequelize.BIGINT.UNSIGNED, allowNull: false },
        sha256: { type: Sequelize.CHAR(64), allowNull: false },
        purpose: { type: Sequelize.STRING(50), allowNull: false },
        owner_user_id: uuidColumn(Sequelize, { allowNull: true }),
        deleted_at: { type: Sequelize.DATE(3), allowNull: true },
        ...auditTimestamps(Sequelize),
      },
      TABLE_OPTIONS,
    );
    await queryInterface.addIndex('stored_files', ['storage_key'], { unique: true, name: 'uq_stored_files_storage_key' });
    await queryInterface.addIndex('stored_files', ['purpose', 'created_at'], { name: 'ix_stored_files_purpose_created' });
    await queryInterface.addIndex('stored_files', ['owner_user_id'], { name: 'ix_stored_files_owner' });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('stored_files');
  },
};
