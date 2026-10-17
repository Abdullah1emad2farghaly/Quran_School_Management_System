'use strict';

/**
 * Approved address rule: center/city and village are FREE TEXT for organizations and schools (same contract as the Parent address,
 * Module 15). Only the governorate stays a registered node; the country stays derived from / constrained by the organization.
 *
 * For `organizations` and `schools`:
 * - adds `center_name` / `village_name` (VARCHAR(200), nullable; a village needs a center, no blank text);
 * - PRESERVES the current addresses: every registered `center_id` / `village_id` is converted to the registered node's name BEFORE the
 *   references are retired (nothing is lost; the names are copied, the geography rows are untouched);
 * - drops the center/village foreign keys, their old CHECK and the id columns.
 * Governorate columns, country columns and the composite country foreign keys are unchanged.
 * Forward-only: `down` refuses (the id columns cannot be rebuilt from free text).
 */
const TABLES = [
  { table: 'organizations', short: 'organizations', fkCenter: 'fk_organizations_center', fkVillage: 'fk_organizations_village' },
  { table: 'schools', short: 'schools', fkCenter: 'fk_schools_center', fkVillage: 'fk_schools_village' },
];

module.exports = {
  async up(queryInterface, Sequelize) {
    const sql = (statement) => queryInterface.sequelize.query(statement);

    for (const t of TABLES) {
      await queryInterface.addColumn(t.table, 'center_name', { type: Sequelize.STRING(200), allowNull: true, after: 'governorate_id' });
      await queryInterface.addColumn(t.table, 'village_name', { type: Sequelize.STRING(200), allowNull: true, after: 'center_name' });
      await sql(`UPDATE ${t.table} x JOIN centers c ON c.id = x.center_id SET x.center_name = c.name`);
      await sql(`UPDATE ${t.table} x JOIN villages v ON v.id = x.village_id SET x.village_name = v.name`);

      const [lost] = await sql(
        `SELECT COUNT(*) AS n FROM ${t.table} WHERE (center_id IS NOT NULL AND center_name IS NULL) OR (village_id IS NOT NULL AND village_name IS NULL)`,
      );
      if (Number(lost[0].n) > 0) throw new Error(`Migration stopped: ${lost[0].n} ${t.table} row(s) could not be converted to text addresses.`);

      await sql(`ALTER TABLE ${t.table} DROP CONSTRAINT ck_${t.short}_village_needs_center`);
      await sql(`ALTER TABLE ${t.table} DROP FOREIGN KEY ${t.fkVillage}`);
      await sql(`ALTER TABLE ${t.table} DROP FOREIGN KEY ${t.fkCenter}`);
      await queryInterface.removeColumn(t.table, 'village_id');
      await queryInterface.removeColumn(t.table, 'center_id');

      await sql(`ALTER TABLE ${t.table} ADD CONSTRAINT ck_${t.short}_village_needs_center CHECK (village_name IS NULL OR center_name IS NOT NULL)`);
      await sql(
        `ALTER TABLE ${t.table} ADD CONSTRAINT ck_${t.short}_address_text CHECK (
           (center_name IS NULL OR CHAR_LENGTH(TRIM(center_name)) > 0) AND (village_name IS NULL OR CHAR_LENGTH(TRIM(village_name)) > 0))`,
      );
    }
  },

  async down() {
    throw new Error('Forward-only migration: free-text-center-village cannot be undone (registered center/village ids cannot be rebuilt from text).');
  },
};
