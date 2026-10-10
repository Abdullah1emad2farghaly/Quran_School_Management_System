'use strict';
const { TABLE_OPTIONS, uuidPrimaryKey, auditTimestamps } = require('../helpers.cjs');

/**
 * Module 13 (Main Organization). Approved business fields only: id, code, name, status.
 * - name: utf8mb4 (table charset), one field, Arabic or English.
 * - V1 allows exactly ONE organization. The rule is enforced by the database, not by convention:
 *   `v1_single_guard` is always 1 (CHECK) and UNIQUE, so a second row is impossible, even when inactive.
 *   For a future multi-organization version drop `uq_organizations_v1_single` (and the column) in a new migration;
 *   nothing else in the model assumes a single row.
 * - Foreign keys: none from this table. Later modules (Geography, Schools) reference organizations.id with
 *   ON DELETE RESTRICT (the approved default).
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable(
      'organizations',
      {
        id: uuidPrimaryKey(Sequelize),
        code: { type: Sequelize.STRING(20), allowNull: false },
        name: { type: Sequelize.STRING(200), allowNull: false },
        status: { type: Sequelize.STRING(16), allowNull: false, defaultValue: 'ACTIVE' },
        v1_single_guard: { type: Sequelize.TINYINT.UNSIGNED, allowNull: false, defaultValue: 1 },
        ...auditTimestamps(Sequelize),
      },
      TABLE_OPTIONS,
    );
    await queryInterface.addIndex('organizations', ['code'], { unique: true, name: 'uq_organizations_code' });
    await queryInterface.addIndex('organizations', ['v1_single_guard'], { unique: true, name: 'uq_organizations_v1_single' });
    const checks = {
      ck_organizations_status: "status IN ('ACTIVE', 'INACTIVE')",
      ck_organizations_code_format: "code REGEXP '^ORG-[0-9]{6}$'",
      ck_organizations_name_not_blank: 'CHAR_LENGTH(TRIM(name)) > 0',
      ck_organizations_v1_single_guard: 'v1_single_guard = 1',
    };
    for (const [name, expression] of Object.entries(checks)) {
      await queryInterface.sequelize.query(`ALTER TABLE organizations ADD CONSTRAINT ${name} CHECK (${expression})`);
    }
  },

  async down(queryInterface) {
    await queryInterface.dropTable('organizations');
  },
};
