'use strict';
const { TABLE_OPTIONS, uuidColumn, uuidPrimaryKey } = require('../helpers.cjs');

/**
 * Approved change: there is no Main School / Sub-School distinction. Every school belongs directly to its organization.
 * DATA PRESERVATION FIRST: before any structural field is dropped, the old information is copied into two append-only archive tables
 * (RESTRICT foreign keys, never deleted):
 *   - `school_classification_archive (school_id, type, parent_school_id, archived_at)`: the old MAIN/SUB type and parent link;
 *   - `school_manager_source_archive (assignment_id, source, archived_at)`: the old manager-link source value.
 * Then:
 *   - `school_managers.source` values are mapped to neutral ones: SUB_SCHOOL_APPROVAL -> APPROVAL, MAIN_ADMIN_ASSIGNMENT -> ASSIGNMENT;
 *   - the type/parent CHECKs, the parent foreign key and index, and the columns `type` and `parent_school_id` are dropped.
 * One fact the type used to imply is made EXPLICIT before the type is dropped: `schools.applicant_user_id` is the user who asked to manage the
 * school (a public submission, former Sub-School requests: backfilled from `created_by`); NULL for schools created directly by an organization
 * manager (former Main Schools). Approval makes the applicant the School Manager; a school without an applicant gets its manager through
 * the explicit assignment operation.
 * Status values are unchanged: PENDING, ACTIVE, INACTIVE, REJECTED. Schools that already exist keep their status: former Main Schools
 * stay ACTIVE (they were created ACTIVE under the previous rule); the new PENDING-first rule applies to schools created from now on.
 * Codes, names, GPS, country and history are untouched.
 * Forward-only: `down` refuses (the archives hold the information if it is ever needed).
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const sql = (statement) => queryInterface.sequelize.query(statement);

    await queryInterface.createTable(
      'school_classification_archive',
      {
        school_id: uuidPrimaryKey(Sequelize),
        type: { type: Sequelize.STRING(8), allowNull: false },
        parent_school_id: uuidColumn(Sequelize, { allowNull: true }),
        archived_at: { type: Sequelize.DATE(3), allowNull: false },
      },
      TABLE_OPTIONS,
    );
    await queryInterface.addConstraint('school_classification_archive', {
      fields: ['school_id'],
      type: 'foreign key',
      name: 'fk_school_classification_archive_school',
      references: { table: 'schools', field: 'id' },
      onDelete: 'RESTRICT',
      onUpdate: 'RESTRICT',
    });
    await sql('INSERT INTO school_classification_archive (school_id, type, parent_school_id, archived_at) SELECT id, type, parent_school_id, UTC_TIMESTAMP(3) FROM schools');

    await queryInterface.createTable(
      'school_manager_source_archive',
      {
        assignment_id: uuidPrimaryKey(Sequelize),
        source: { type: Sequelize.STRING(24), allowNull: false },
        archived_at: { type: Sequelize.DATE(3), allowNull: false },
      },
      TABLE_OPTIONS,
    );
    await queryInterface.addConstraint('school_manager_source_archive', {
      fields: ['assignment_id'],
      type: 'foreign key',
      name: 'fk_school_manager_source_archive_assignment',
      references: { table: 'school_managers', field: 'id' },
      onDelete: 'RESTRICT',
      onUpdate: 'RESTRICT',
    });
    await sql('INSERT INTO school_manager_source_archive (assignment_id, source, archived_at) SELECT id, source, UTC_TIMESTAMP(3) FROM school_managers');

    await sql('ALTER TABLE school_managers DROP CONSTRAINT ck_school_managers_source');
    await sql("UPDATE school_managers SET source = 'APPROVAL' WHERE source = 'SUB_SCHOOL_APPROVAL'");
    await sql("UPDATE school_managers SET source = 'ASSIGNMENT' WHERE source = 'MAIN_ADMIN_ASSIGNMENT'");
    await sql("ALTER TABLE school_managers ADD CONSTRAINT ck_school_managers_source CHECK (source IN ('APPROVAL','ASSIGNMENT'))");

    await queryInterface.addColumn('schools', 'applicant_user_id', uuidColumn(Sequelize, { allowNull: true, after: 'created_by' }));
    await sql("UPDATE schools SET applicant_user_id = created_by WHERE type = 'SUB'");

    await sql('ALTER TABLE schools DROP CONSTRAINT ck_schools_type_parent');
    await sql('ALTER TABLE schools DROP CONSTRAINT ck_schools_main_status');
    await sql('ALTER TABLE schools DROP CONSTRAINT ck_schools_type');
    await sql('ALTER TABLE schools DROP FOREIGN KEY fk_schools_parent');
    await queryInterface.removeIndex('schools', 'ix_schools_parent');
    await queryInterface.removeColumn('schools', 'parent_school_id');
    await queryInterface.removeColumn('schools', 'type');
  },

  async down() {
    throw new Error('Forward-only migration: schools-remove-main-sub cannot be undone (see school_classification_archive for the preserved data).');
  },
};
