'use strict';

/**
 * Module 16 fix (found by `npm run test:db`): the CHECK `ck_schools_holds_name` let a NON-rejected school have
 * `holds_name = NULL`. SQL treats a CHECK that evaluates to UNKNOWN as satisfied, and `NULL = 1` is UNKNOWN, so the second
 * branch did not reject it. That would defeat the per-organization unique name (NULLs never collide in a unique index).
 * The corrected check states explicitly that a non-rejected school holds its name (`holds_name IS NOT NULL AND = 1`).
 * A new migration: the applied `create-schools` migration is never edited. The application always wrote the right value,
 * so no existing row can violate the new check.
 */
const CORRECTED = "(status = 'REJECTED' AND holds_name IS NULL) OR (status <> 'REJECTED' AND holds_name IS NOT NULL AND holds_name = 1)";
const ORIGINAL = "(status = 'REJECTED' AND holds_name IS NULL) OR (status <> 'REJECTED' AND holds_name = 1)";

module.exports = {
  async up(queryInterface) {
    const sql = (statement) => queryInterface.sequelize.query(statement);
    await sql('ALTER TABLE schools DROP CONSTRAINT ck_schools_holds_name');
    await sql(`ALTER TABLE schools ADD CONSTRAINT ck_schools_holds_name CHECK (${CORRECTED})`);
  },

  async down(queryInterface) {
    const sql = (statement) => queryInterface.sequelize.query(statement);
    await sql('ALTER TABLE schools DROP CONSTRAINT ck_schools_holds_name');
    await sql(`ALTER TABLE schools ADD CONSTRAINT ck_schools_holds_name CHECK (${ORIGINAL})`);
  },
};
