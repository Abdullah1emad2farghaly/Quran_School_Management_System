'use strict';
const { uuidColumn } = require('../helpers.cjs');

/**
 * Module 16 / 13 / 14: every school has the SAME country as its organization, enforced by the database.
 * - `governorates (id, country_id)` becomes unique (no data change) so it can be referenced by two columns;
 * - `schools.country_id` (the school's country, derived by the application from its organization; never trusted from a client)
 *   gets two composite foreign keys, both RESTRICT:
 *     (organization_id, country_id)  -> organizations (id, country_id)   the school's country = its organization's country
 *     (governorate_id,  country_id)  -> governorates   (id, country_id)  the school's governorate belongs to that country
 *   An organization whose country is not set (NULL) cannot own a school; an organization's country cannot be changed (or
 *   its id) while schools reference it, so an organization's country can never silently invalidate its schools.
 * - Existing rows: country_id is backfilled from each school's governorate. If any existing school's country differs from its
 *   organization's country (or the organization has no country), the migration STOPS with the list instead of changing
 *   data (a business decision). Each school keeps its own governorate/center/village address; only the country is constrained.
 * Never edits an applied migration.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const sql = (statement) => queryInterface.sequelize.query(statement);

    const [conflicts] = await sql(
      `SELECT s.code AS school, o.code AS organization, o.country_id AS organization_country, g.country_id AS school_country
         FROM schools s
         JOIN governorates g ON g.id = s.governorate_id
         JOIN organizations o ON o.id = s.organization_id
        WHERE o.country_id IS NULL OR o.country_id <> g.country_id
        LIMIT 20`,
    );
    if (conflicts.length > 0) {
      throw new Error(
        `Migration stopped: ${conflicts.length}+ existing school(s) do not match their organization's country (or the organization has no country). ` +
          'Assign the organization country (npm run bootstrap:organization) or correct the school, then run the migration again. First rows: ' +
          JSON.stringify(conflicts),
      );
    }

    await sql('ALTER TABLE governorates ADD UNIQUE KEY uq_governorates_id_country (id, country_id)');

    await queryInterface.addColumn('schools', 'country_id', uuidColumn(Sequelize, { allowNull: true, after: 'organization_id' }));
    await sql('UPDATE schools s JOIN governorates g ON g.id = s.governorate_id SET s.country_id = g.country_id');
    await queryInterface.changeColumn('schools', 'country_id', uuidColumn(Sequelize, { allowNull: false }));

    await sql(
      `ALTER TABLE schools ADD CONSTRAINT fk_schools_org_country FOREIGN KEY (organization_id, country_id)
         REFERENCES organizations (id, country_id) ON DELETE RESTRICT ON UPDATE RESTRICT`,
    );
    await sql(
      `ALTER TABLE schools ADD CONSTRAINT fk_schools_gov_country FOREIGN KEY (governorate_id, country_id)
         REFERENCES governorates (id, country_id) ON DELETE RESTRICT ON UPDATE RESTRICT`,
    );
  },

  async down(queryInterface) {
    const sql = (statement) => queryInterface.sequelize.query(statement);
    await sql('ALTER TABLE schools DROP FOREIGN KEY fk_schools_gov_country');
    await sql('ALTER TABLE schools DROP FOREIGN KEY fk_schools_org_country');
    await queryInterface.removeColumn('schools', 'country_id');
    await sql('ALTER TABLE governorates DROP INDEX uq_governorates_id_country');
  },
};
