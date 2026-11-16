'use strict';
const { TABLE_OPTIONS, uuidPrimaryKey, uuidColumn, auditTimestamps } = require('../helpers.cjs');

/**
 * Module 36 (Excel Import). One table, no foreign keys to other modules' tables (Master Specification §14).
 * - excel_import_previews: the server-side preview of an uploaded workbook (24 hours), private to its creator. The parsed rows and the analysis are
 *   JSON text (source_rows, analysis) and hold personal data, so they are set to NULL as soon as the preview is confirmed, cancelled or expired;
 *   the summary and the commit result stay. `file_id` points at Module 07's stored file (no foreign key).
 * No existing table is changed.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable(
      'excel_import_previews',
      {
        id: uuidPrimaryKey(Sequelize),
        school_id: uuidColumn(Sequelize),
        organization_id: uuidColumn(Sequelize),
        created_by: uuidColumn(Sequelize),
        file_id: uuidColumn(Sequelize, { allowNull: true }),
        original_name: { type: Sequelize.STRING(255), allowNull: false },
        language: { type: Sequelize.STRING(2), allowNull: false },
        status: { type: Sequelize.STRING(16), allowNull: false },
        can_confirm: { type: Sequelize.TINYINT, allowNull: false },
        blocking: { type: Sequelize.INTEGER.UNSIGNED, allowNull: false },
        summary: { type: Sequelize.TEXT('long'), allowNull: false },
        source_rows: { type: Sequelize.TEXT('long'), allowNull: true },
        analysis: { type: Sequelize.TEXT('long'), allowNull: true },
        result: { type: Sequelize.TEXT('long'), allowNull: true },
        expires_at: { type: Sequelize.DATE(3), allowNull: false },
        decided_at: { type: Sequelize.DATE(3), allowNull: true },
        decided_by: uuidColumn(Sequelize, { allowNull: true }),
        version: { type: Sequelize.INTEGER.UNSIGNED, allowNull: false, defaultValue: 1 },
        ...auditTimestamps(Sequelize),
      },
      TABLE_OPTIONS,
    );
    await queryInterface.addIndex('excel_import_previews', ['created_by', 'status'], { name: 'ix_excel_import_previews_owner' });
    await queryInterface.addIndex('excel_import_previews', ['status', 'expires_at'], { name: 'ix_excel_import_previews_expiry' });
    await queryInterface.addIndex('excel_import_previews', ['school_id'], { name: 'ix_excel_import_previews_school' });
    await queryInterface.sequelize.query(
      "ALTER TABLE excel_import_previews ADD CONSTRAINT ck_excel_import_previews_status CHECK (status IN ('PENDING','CONFIRMED','CANCELLED','EXPIRED'))",
    );
  },

  async down(queryInterface) {
    await queryInterface.dropTable('excel_import_previews');
  },
};
