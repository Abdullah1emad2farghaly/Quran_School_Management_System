'use strict';
const { TABLE_OPTIONS, uuidPrimaryKey, uuidColumn, auditTimestamps } = require('../helpers.cjs');

/**
 * Module 19 (Students). Two tables, no foreign keys to other modules' tables (Master Specification §14); the one key below points only at this
 * module's own `students` table.
 * - students: one row per Student. A Student is a business entity only (no login). `parent_id` and `school_id` are plain references to
 *   Module 17 / Module 16 data (validated by the application in the registration transaction, never by a cross-module key). The group is NOT
 *   stored here (Module 20 owns it) and neither is an address (derived from the Parent, §37).
 *   - `national_id` is UNIQUE GLOBALLY: one index over the whole table, every organization, school and status (an ARCHIVED student keeps
 *     its National ID reserved). CHECKs reinforce the application rules: exactly 14 ASCII digits, a known status, a non-blank name.
 *   - `status` is ACTIVE / INACTIVE / ARCHIVED. Students are never deleted.
 * - student_history: append-only history of registration, corrections and lifecycle changes (who, when, previous value, reason). `seq` is the
 *   insertion order (several rows can share a millisecond). Rows are never updated or deleted.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable(
      'students',
      {
        id: uuidPrimaryKey(Sequelize),
        school_id: uuidColumn(Sequelize),
        organization_id: uuidColumn(Sequelize),
        parent_id: uuidColumn(Sequelize),
        full_name: { type: Sequelize.STRING(200), allowNull: false },
        national_id: { type: Sequelize.CHAR(14), allowNull: false },
        join_date: { type: Sequelize.DATEONLY, allowNull: false },
        status: { type: Sequelize.STRING(16), allowNull: false },
        created_by: uuidColumn(Sequelize),
        version: { type: Sequelize.INTEGER.UNSIGNED, allowNull: false, defaultValue: 1 },
        ...auditTimestamps(Sequelize),
      },
      TABLE_OPTIONS,
    );
    await queryInterface.addIndex('students', ['national_id'], { unique: true, name: 'uq_students_national_id' });
    await queryInterface.addIndex('students', ['school_id', 'status'], { name: 'ix_students_school_status' });
    await queryInterface.addIndex('students', ['school_id', 'created_at'], { name: 'ix_students_school_created' });
    await queryInterface.addIndex('students', ['parent_id', 'school_id'], { name: 'ix_students_parent_school' });
    await queryInterface.sequelize.query("ALTER TABLE students ADD CONSTRAINT ck_students_status CHECK (status IN ('ACTIVE', 'INACTIVE', 'ARCHIVED'))");
    await queryInterface.sequelize.query("ALTER TABLE students ADD CONSTRAINT ck_students_national_id CHECK (CHAR_LENGTH(national_id) = 14 AND national_id REGEXP '^[0-9]+$')");
    await queryInterface.sequelize.query("ALTER TABLE students ADD CONSTRAINT ck_students_full_name CHECK (CHAR_LENGTH(TRIM(full_name)) > 0)");

    await queryInterface.createTable(
      'student_history',
      {
        id: uuidPrimaryKey(Sequelize),
        student_id: uuidColumn(Sequelize, { references: { model: 'students', key: 'id' }, onDelete: 'RESTRICT', onUpdate: 'RESTRICT' }),
        action: { type: Sequelize.STRING(20), allowNull: false },
        actor_id: uuidColumn(Sequelize),
        occurred_at: { type: Sequelize.DATE(3), allowNull: false },
        reason: { type: Sequelize.STRING(500), allowNull: true },
        previous_status: { type: Sequelize.STRING(16), allowNull: true },
        new_status: { type: Sequelize.STRING(16), allowNull: true },
        previous_full_name: { type: Sequelize.STRING(200), allowNull: true },
        new_full_name: { type: Sequelize.STRING(200), allowNull: true },
        previous_join_date: { type: Sequelize.DATEONLY, allowNull: true },
        new_join_date: { type: Sequelize.DATEONLY, allowNull: true },
      },
      TABLE_OPTIONS,
    );
    // Insertion order of the history (AUTO_INCREMENT must be a key, so the column and its unique key are added together).
    await queryInterface.sequelize.query('ALTER TABLE student_history ADD COLUMN seq BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, ADD UNIQUE KEY uq_student_history_seq (seq)');
    await queryInterface.addIndex('student_history', ['student_id', 'seq'], { name: 'ix_student_history_student' });
    await queryInterface.sequelize.query("ALTER TABLE student_history ADD CONSTRAINT ck_student_history_action CHECK (action IN ('REGISTERED', 'DETAILS_UPDATED', 'STATUS_CHANGED'))");
  },

  async down(queryInterface) {
    await queryInterface.dropTable('student_history');
    await queryInterface.dropTable('students');
  },
};
