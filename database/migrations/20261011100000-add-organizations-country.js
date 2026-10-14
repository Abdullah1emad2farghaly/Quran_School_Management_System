'use strict';
const { uuidColumn } = require('../helpers.cjs');

/**
 * Module 13 (Main Organization), Module 15 groundwork: the country of the Main Organization.
 * - `organizations.country_id` is the PRIMARY KEY of a `countries` row (CHAR(36) UUID, the same type as `countries.id`),
 *   never a country code such as CNT-000001. Foreign key ON DELETE / ON UPDATE RESTRICT.
 * - Nullable: the existing organization row has no country yet and its data is NOT touched here (this migration may run
 *   before the geography seed). The country is assigned once, by `npm run bootstrap:organization` (immutable in V1).
 * - Immutability is enforced by the application (domain + set-once UPDATE), not by a trigger; a direct database update
 *   outside the application is not prevented.
 * Requires the `countries` table (migration create-geography, 20261010150000). Never edits an applied migration.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('organizations', 'country_id', uuidColumn(Sequelize, { allowNull: true, after: 'status' }));
    await queryInterface.addConstraint('organizations', {
      fields: ['country_id'],
      type: 'foreign key',
      name: 'fk_organizations_country',
      references: { table: 'countries', field: 'id' },
      onDelete: 'RESTRICT',
      onUpdate: 'RESTRICT',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeConstraint('organizations', 'fk_organizations_country');
    await queryInterface.removeColumn('organizations', 'country_id');
  },
};
