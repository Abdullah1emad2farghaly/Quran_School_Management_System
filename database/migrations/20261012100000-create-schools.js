'use strict';
const { TABLE_OPTIONS, uuidColumn, uuidPrimaryKey, auditTimestamps } = require('../helpers.cjs');

/**
 * Module 16 (Schools), Master Specification §29-31. Tables: schools, school_managers, school_status_history,
 * school_gps_history, school_code_sequence. MariaDB 10.4 / MySQL, utf8mb4_unicode_ci, DATETIME(3) UTC.
 * - Foreign keys use the approved default ON DELETE / ON UPDATE RESTRICT (organizations, geography, schools).
 *   Users are referenced WITHOUT foreign keys (each module owns its tables, §14; same as user_roles).
 * - School names are unique per organization among NON-rejected schools: `holds_name` is 1 while the school holds its name
 *   and NULL once REJECTED (the same NULL-in-unique-index pattern as user_roles.active). Compared under utf8mb4_unicode_ci.
 * - One active manager per school: `school_managers.active` is 1 while current and NULL once revoked, unique with school_id.
 * - Gap-free codes: `school_code_sequence` holds ONE row that the creating transaction locks and increments.
 * - The official GPS is stored on the school; changes while PENDING are kept in school_gps_history; after approval the
 *   application refuses changes (immutable in V1).
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const sql = (statement) => queryInterface.sequelize.query(statement);

    await queryInterface.createTable(
      'school_code_sequence',
      {
        name: { type: Sequelize.STRING(32), allowNull: false, primaryKey: true },
        last_value: { type: Sequelize.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
        updated_at: { type: Sequelize.DATE(3), allowNull: false },
      },
      TABLE_OPTIONS,
    );
    await sql("INSERT INTO school_code_sequence (name, last_value, updated_at) VALUES ('school', 0, UTC_TIMESTAMP(3))");
    await sql("ALTER TABLE school_code_sequence ADD CONSTRAINT ck_school_code_sequence_range CHECK (last_value <= 999999)");

    await queryInterface.createTable(
      'schools',
      {
        id: uuidPrimaryKey(Sequelize),
        code: { type: Sequelize.STRING(20), allowNull: false },
        name: { type: Sequelize.STRING(200), allowNull: false },
        type: { type: Sequelize.STRING(8), allowNull: false },
        status: { type: Sequelize.STRING(16), allowNull: false },
        organization_id: uuidColumn(Sequelize),
        parent_school_id: uuidColumn(Sequelize, { allowNull: true }),
        governorate_id: uuidColumn(Sequelize),
        center_id: uuidColumn(Sequelize, { allowNull: true }),
        village_id: uuidColumn(Sequelize, { allowNull: true }),
        latitude: { type: Sequelize.DECIMAL(10, 7), allowNull: false },
        longitude: { type: Sequelize.DECIMAL(10, 7), allowNull: false },
        gps_accuracy_m: { type: Sequelize.DECIMAL(6, 2), allowNull: false },
        created_by: uuidColumn(Sequelize),
        decided_by: uuidColumn(Sequelize, { allowNull: true }),
        decided_at: { type: Sequelize.DATE(3), allowNull: true },
        rejection_reason: { type: Sequelize.STRING(500), allowNull: true },
        holds_name: { type: Sequelize.TINYINT(1), allowNull: true },
        version: { type: Sequelize.INTEGER.UNSIGNED, allowNull: false, defaultValue: 1 },
        ...auditTimestamps(Sequelize),
      },
      TABLE_OPTIONS,
    );
    await queryInterface.addIndex('schools', ['code'], { unique: true, name: 'uq_schools_code' });
    await queryInterface.addIndex('schools', ['organization_id', 'name', 'holds_name'], { unique: true, name: 'uq_schools_org_name' });
    await queryInterface.addIndex('schools', ['parent_school_id'], { name: 'ix_schools_parent' });
    await queryInterface.addIndex('schools', ['governorate_id'], { name: 'ix_schools_governorate' });
    await queryInterface.addIndex('schools', ['organization_id', 'status'], { name: 'ix_schools_org_status' });
    const fks = [
      ['fk_schools_organization', 'organization_id', 'organizations'],
      ['fk_schools_parent', 'parent_school_id', 'schools'],
      ['fk_schools_governorate', 'governorate_id', 'governorates'],
      ['fk_schools_center', 'center_id', 'centers'],
      ['fk_schools_village', 'village_id', 'villages'],
    ];
    for (const [name, column, table] of fks) {
      await queryInterface.addConstraint('schools', {
        fields: [column],
        type: 'foreign key',
        name,
        references: { table, field: 'id' },
        onDelete: 'RESTRICT',
        onUpdate: 'RESTRICT',
      });
    }
    const checks = {
      ck_schools_type: "type IN ('MAIN','SUB')",
      ck_schools_status: "status IN ('PENDING','ACTIVE','INACTIVE','REJECTED')",
      ck_schools_code_format: "code REGEXP '^SC-[0-9]{6}$'",
      ck_schools_name_not_blank: 'CHAR_LENGTH(TRIM(name)) > 0',
      ck_schools_type_parent: "(type = 'MAIN' AND parent_school_id IS NULL) OR (type = 'SUB' AND parent_school_id IS NOT NULL)",
      ck_schools_main_status: "type = 'SUB' OR status IN ('ACTIVE','INACTIVE')",
      ck_schools_village_needs_center: 'village_id IS NULL OR center_id IS NOT NULL',
      ck_schools_gps_range: 'latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180',
      ck_schools_gps_accuracy: 'gps_accuracy_m > 0 AND gps_accuracy_m <= 20',
      ck_schools_holds_name: "(status = 'REJECTED' AND holds_name IS NULL) OR (status <> 'REJECTED' AND holds_name = 1)",
      ck_schools_rejection:
        "status <> 'REJECTED' OR (rejection_reason IS NOT NULL AND CHAR_LENGTH(TRIM(rejection_reason)) > 0 AND decided_by IS NOT NULL AND decided_at IS NOT NULL)",
    };
    for (const [name, expression] of Object.entries(checks)) {
      await sql(`ALTER TABLE schools ADD CONSTRAINT ${name} CHECK (${expression})`);
    }

    await queryInterface.createTable(
      'school_managers',
      {
        id: uuidPrimaryKey(Sequelize),
        school_id: uuidColumn(Sequelize),
        user_id: uuidColumn(Sequelize),
        source: { type: Sequelize.STRING(24), allowNull: false },
        assigned_at: { type: Sequelize.DATE(3), allowNull: false },
        assigned_by: uuidColumn(Sequelize),
        revoked_at: { type: Sequelize.DATE(3), allowNull: true },
        revoked_by: uuidColumn(Sequelize, { allowNull: true }),
        active: { type: Sequelize.TINYINT(1), allowNull: true },
        version: { type: Sequelize.INTEGER.UNSIGNED, allowNull: false, defaultValue: 1 },
        ...auditTimestamps(Sequelize),
      },
      TABLE_OPTIONS,
    );
    await queryInterface.addIndex('school_managers', ['school_id', 'active'], { unique: true, name: 'uq_school_managers_active_school' });
    await queryInterface.addIndex('school_managers', ['user_id', 'active'], { name: 'ix_school_managers_user_active' });
    await queryInterface.addConstraint('school_managers', {
      fields: ['school_id'],
      type: 'foreign key',
      name: 'fk_school_managers_school',
      references: { table: 'schools', field: 'id' },
      onDelete: 'RESTRICT',
      onUpdate: 'RESTRICT',
    });
    await sql("ALTER TABLE school_managers ADD CONSTRAINT ck_school_managers_source CHECK (source IN ('SUB_SCHOOL_APPROVAL','MAIN_ADMIN_ASSIGNMENT'))");
    await sql(
      `ALTER TABLE school_managers ADD CONSTRAINT ck_school_managers_state CHECK (
         (active = 1 AND revoked_at IS NULL AND revoked_by IS NULL)
         OR (active IS NULL AND revoked_at IS NOT NULL AND revoked_by IS NOT NULL))`,
    );

    await queryInterface.createTable(
      'school_status_history',
      {
        id: uuidPrimaryKey(Sequelize),
        school_id: uuidColumn(Sequelize),
        from_status: { type: Sequelize.STRING(16), allowNull: true },
        to_status: { type: Sequelize.STRING(16), allowNull: false },
        changed_by: uuidColumn(Sequelize),
        reason: { type: Sequelize.STRING(500), allowNull: true },
        changed_at: { type: Sequelize.DATE(3), allowNull: false },
        created_at: { type: Sequelize.DATE(3), allowNull: false },
      },
      TABLE_OPTIONS,
    );
    await queryInterface.addIndex('school_status_history', ['school_id', 'changed_at'], { name: 'ix_school_status_history_school' });
    await queryInterface.addConstraint('school_status_history', {
      fields: ['school_id'],
      type: 'foreign key',
      name: 'fk_school_status_history_school',
      references: { table: 'schools', field: 'id' },
      onDelete: 'RESTRICT',
      onUpdate: 'RESTRICT',
    });
    await sql("ALTER TABLE school_status_history ADD CONSTRAINT ck_school_status_history_to CHECK (to_status IN ('PENDING','ACTIVE','INACTIVE','REJECTED'))");

    await queryInterface.createTable(
      'school_gps_history',
      {
        id: uuidPrimaryKey(Sequelize),
        school_id: uuidColumn(Sequelize),
        previous_latitude: { type: Sequelize.DECIMAL(10, 7), allowNull: false },
        previous_longitude: { type: Sequelize.DECIMAL(10, 7), allowNull: false },
        previous_accuracy_m: { type: Sequelize.DECIMAL(6, 2), allowNull: false },
        new_latitude: { type: Sequelize.DECIMAL(10, 7), allowNull: false },
        new_longitude: { type: Sequelize.DECIMAL(10, 7), allowNull: false },
        new_accuracy_m: { type: Sequelize.DECIMAL(6, 2), allowNull: false },
        changed_by: uuidColumn(Sequelize),
        changed_at: { type: Sequelize.DATE(3), allowNull: false },
        created_at: { type: Sequelize.DATE(3), allowNull: false },
      },
      TABLE_OPTIONS,
    );
    await queryInterface.addIndex('school_gps_history', ['school_id', 'changed_at'], { name: 'ix_school_gps_history_school' });
    await queryInterface.addConstraint('school_gps_history', {
      fields: ['school_id'],
      type: 'foreign key',
      name: 'fk_school_gps_history_school',
      references: { table: 'schools', field: 'id' },
      onDelete: 'RESTRICT',
      onUpdate: 'RESTRICT',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('school_gps_history');
    await queryInterface.dropTable('school_status_history');
    await queryInterface.dropTable('school_managers');
    await queryInterface.dropTable('schools');
    await queryInterface.dropTable('school_code_sequence');
  },
};
