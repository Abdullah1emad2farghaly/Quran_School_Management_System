'use strict';
const { TABLE_OPTIONS, uuidPrimaryKey, auditTimestamps } = require('../helpers.cjs');

/**
 * Module 14 (Geography): global, shared reference data (NOT owned by an organization: no organization_id anywhere).
 * Hierarchy: countries -> governorates -> centers (Center/City, one level, kind CENTER|CITY) -> villages.
 * Each level references only its parent with a real foreign key, ON DELETE RESTRICT / ON UPDATE RESTRICT.
 * Approved fields only: id, code, name (one required field, Arabic or English, utf8mb4), status, plus the parent
 * reference and the center `kind`. Codes: CNT-/GOV-/CTR-/VIL- + 6 digits, checked byte-exactly (case-sensitive).
 * Uniqueness: country name; governorate name per country; center name per governorate AND kind (a city and a center can
 * share a name); village name per center. There is no delete or rename path: retirement is status = INACTIVE only.
 * Later modules (Unified Address, Schools) reference these ids with ON DELETE RESTRICT.
 */
const codeCheck = (prefix) => `CHAR_LENGTH(code) = 10 AND BINARY LEFT(code, 4) = '${prefix}-' AND SUBSTRING(code, 5) REGEXP '^[0-9]{6}$'`;

const LEVELS = [
  { table: 'countries', short: 'countries', prefix: 'CNT', parent: null },
  { table: 'governorates', short: 'governorates', prefix: 'GOV', parent: { column: 'country_id', table: 'countries', fk: 'fk_governorates_country' } },
  { table: 'centers', short: 'centers', prefix: 'CTR', parent: { column: 'governorate_id', table: 'governorates', fk: 'fk_centers_governorate' }, kind: true },
  { table: 'villages', short: 'villages', prefix: 'VIL', parent: { column: 'center_id', table: 'centers', fk: 'fk_villages_center' } },
];

module.exports = {
  async up(queryInterface, Sequelize) {
    for (const level of LEVELS) {
      const columns = {
        id: uuidPrimaryKey(Sequelize),
        code: { type: Sequelize.STRING(20), allowNull: false },
        name: { type: Sequelize.STRING(200), allowNull: false },
        status: { type: Sequelize.STRING(16), allowNull: false, defaultValue: 'ACTIVE' },
      };
      if (level.parent) columns[level.parent.column] = { type: Sequelize.CHAR(36), allowNull: false };
      if (level.kind) columns.kind = { type: Sequelize.STRING(16), allowNull: false };
      await queryInterface.createTable(level.table, { ...columns, ...auditTimestamps(Sequelize) }, TABLE_OPTIONS);

      await queryInterface.addIndex(level.table, ['code'], { unique: true, name: `uq_${level.short}_code` });
      const nameKey = [...(level.parent ? [level.parent.column] : []), ...(level.kind ? ['kind'] : []), 'name'];
      await queryInterface.addIndex(level.table, nameKey, { unique: true, name: `uq_${level.short}_name` });

      if (level.parent) {
        await queryInterface.addConstraint(level.table, {
          fields: [level.parent.column],
          type: 'foreign key',
          name: level.parent.fk,
          references: { table: level.parent.table, field: 'id' },
          onDelete: 'RESTRICT',
          onUpdate: 'RESTRICT',
        });
      }
      const checks = {
        [`ck_${level.short}_status`]: "status IN ('ACTIVE', 'INACTIVE')",
        [`ck_${level.short}_code_format`]: codeCheck(level.prefix),
        [`ck_${level.short}_name_not_blank`]: 'CHAR_LENGTH(TRIM(name)) > 0',
      };
      if (level.kind) checks[`ck_${level.short}_kind`] = "kind IN ('CENTER', 'CITY')";
      for (const [name, expression] of Object.entries(checks)) {
        await queryInterface.sequelize.query(`ALTER TABLE ${level.table} ADD CONSTRAINT ${name} CHECK (${expression})`);
      }
    }
  },

  async down(queryInterface) {
    for (const level of [...LEVELS].reverse()) await queryInterface.dropTable(level.table);
  },
};
