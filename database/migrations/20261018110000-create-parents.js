'use strict';
const { TABLE_OPTIONS, uuidPrimaryKey, uuidColumn, auditTimestamps } = require('../helpers.cjs');

/**
 * Module 17 (Parents). Three tables, no foreign keys to other modules' tables (Master Specification §14); the keys below point only
 * at this module's own `parents` table.
 * - parents: one Parent record per login account (unique user_id) with the normalized three-part name and the organization.
 * - parent_addresses: the Parent Address HISTORY (§28). Rows are never deleted or edited except to end them; `active` is 1 for the current
 *   row and NULL once replaced, so the unique (parent_id, active) index allows exactly one current address per Parent. The Governorate
 *   name is stored as a snapshot so an old address keeps reading the same. center/village are free text (village only under a center).
 * - parent_schools: the Parent-to-School relationship with history (never deleted). `active` is 1 while current and NULL once removed,
 *   so (parent_id, school_id, active) allows ONE active link per school and any number of ended ones.
 * The CHECKs use the NULL-safe `<=>`: with a plain `=` a row that is neither current nor ended evaluates to NULL, which a CHECK accepts.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable(
      'parents',
      {
        id: uuidPrimaryKey(Sequelize),
        user_id: uuidColumn(Sequelize),
        organization_id: uuidColumn(Sequelize),
        full_name: { type: Sequelize.STRING(200), allowNull: false },
        created_by: uuidColumn(Sequelize),
        version: { type: Sequelize.INTEGER.UNSIGNED, allowNull: false, defaultValue: 1 },
        ...auditTimestamps(Sequelize),
      },
      TABLE_OPTIONS,
    );
    await queryInterface.addIndex('parents', ['user_id'], { unique: true, name: 'uq_parents_user' });
    await queryInterface.addIndex('parents', ['organization_id'], { name: 'ix_parents_organization' });

    await queryInterface.createTable(
      'parent_addresses',
      {
        id: uuidPrimaryKey(Sequelize),
        parent_id: uuidColumn(Sequelize, { references: { model: 'parents', key: 'id' }, onDelete: 'RESTRICT', onUpdate: 'RESTRICT' }),
        governorate_id: uuidColumn(Sequelize),
        governorate_name: { type: Sequelize.STRING(200), allowNull: false },
        center_name: { type: Sequelize.STRING(200), allowNull: true },
        village_name: { type: Sequelize.STRING(200), allowNull: true },
        created_by: uuidColumn(Sequelize),
        created_at: { type: Sequelize.DATE(3), allowNull: false },
        ended_at: { type: Sequelize.DATE(3), allowNull: true },
        active: { type: Sequelize.TINYINT, allowNull: true },
      },
      TABLE_OPTIONS,
    );
    await queryInterface.addIndex('parent_addresses', ['parent_id', 'active'], { unique: true, name: 'uq_parent_addresses_current' });
    await queryInterface.addIndex('parent_addresses', ['parent_id', 'created_at'], { name: 'ix_parent_addresses_history' });
    await queryInterface.sequelize.query(
      'ALTER TABLE parent_addresses ADD CONSTRAINT ck_parent_addresses_village CHECK (village_name IS NULL OR center_name IS NOT NULL)',
    );
    await queryInterface.sequelize.query(
      'ALTER TABLE parent_addresses ADD CONSTRAINT ck_parent_addresses_active CHECK ((active <=> 1 AND ended_at IS NULL) OR (active IS NULL AND ended_at IS NOT NULL))',
    );

    await queryInterface.createTable(
      'parent_schools',
      {
        id: uuidPrimaryKey(Sequelize),
        parent_id: uuidColumn(Sequelize, { references: { model: 'parents', key: 'id' }, onDelete: 'RESTRICT', onUpdate: 'RESTRICT' }),
        school_id: uuidColumn(Sequelize),
        linked_at: { type: Sequelize.DATE(3), allowNull: false },
        linked_by: uuidColumn(Sequelize),
        unlinked_at: { type: Sequelize.DATE(3), allowNull: true },
        unlinked_by: uuidColumn(Sequelize, { allowNull: true }),
        active: { type: Sequelize.TINYINT, allowNull: true },
        version: { type: Sequelize.INTEGER.UNSIGNED, allowNull: false, defaultValue: 1 },
        ...auditTimestamps(Sequelize),
      },
      TABLE_OPTIONS,
    );
    await queryInterface.addIndex('parent_schools', ['parent_id', 'school_id', 'active'], { unique: true, name: 'uq_parent_schools_active' });
    await queryInterface.addIndex('parent_schools', ['school_id', 'active'], { name: 'ix_parent_schools_school' });
    await queryInterface.sequelize.query(
      'ALTER TABLE parent_schools ADD CONSTRAINT ck_parent_schools_active CHECK ((active <=> 1 AND unlinked_at IS NULL AND unlinked_by IS NULL) OR (active IS NULL AND unlinked_at IS NOT NULL AND unlinked_by IS NOT NULL))',
    );
  },

  async down(queryInterface) {
    await queryInterface.dropTable('parent_schools');
    await queryInterface.dropTable('parent_addresses');
    await queryInterface.dropTable('parents');
  },
};
