'use strict';

/**
 * Corrective migration for 20261010130000-create-organizations (already applied on existing databases, so it is NOT edited).
 * The original CHECK used `code REGEXP '^ORG-[0-9]{6}$'`; on a *_ci collation MariaDB's REGEXP ignores case, so
 * 'org-000001' was accepted. The new CHECK compares the prefix byte-exactly (BINARY) and uses a regex only for the digits,
 * where case does not matter. Existing valid rows (ORG-000001) still satisfy it; no data is changed or deleted.
 */
const NEW_CHECK = "CHAR_LENGTH(code) = 10 AND BINARY LEFT(code, 4) = 'ORG-' AND SUBSTRING(code, 5) REGEXP '^[0-9]{6}$'";
const OLD_CHECK = "code REGEXP '^ORG-[0-9]{6}$'";

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query('ALTER TABLE organizations DROP CONSTRAINT ck_organizations_code_format');
    await queryInterface.sequelize.query(`ALTER TABLE organizations ADD CONSTRAINT ck_organizations_code_format CHECK (${NEW_CHECK})`);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query('ALTER TABLE organizations DROP CONSTRAINT ck_organizations_code_format');
    await queryInterface.sequelize.query(`ALTER TABLE organizations ADD CONSTRAINT ck_organizations_code_format CHECK (${OLD_CHECK})`);
  },
};
