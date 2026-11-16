'use strict';
const { TABLE_OPTIONS, uuidPrimaryKey, uuidColumn } = require('../helpers.cjs');

/**
 * Module 26 (Attendance, Master Specification §51). Two tables, no foreign keys to other modules' tables (§14).
 * - attendance_records: the attendance of ONE subject (a STUDENT, or the session's TEACHER) for ONE class session. UNIQUE (session_id, subject_type, subject_id)
 *   = Session + Student and Session + Teacher. Status PRESENT or ABSENT. `session_id`, `school_id`, `group_id`, `subject_id` are plain references to Module 24 / 16 /
 *   20 / 19 / 18 data (validated by the application); `occurrence_date` and `scheduled_start` are a snapshot of the session so a student's attendance lists by date
 *   without reading sessions. A student without a row is UNMARKED: nothing creates rows automatically. Rows are NEVER deleted.
 * - attendance_correction_history: APPEND-ONLY. One row per correction (a change of an existing record's status): previous and new status, the reason, who (user id and
 *   role), when. The application never updates or deletes a history row. `seq` is the insertion order.
 * Every column is NOT NULL, so no CHECK can pass on a NULL (a CHECK only rejects FALSE).
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable(
      'attendance_records',
      {
        id: uuidPrimaryKey(Sequelize),
        session_id: uuidColumn(Sequelize),
        school_id: uuidColumn(Sequelize),
        group_id: uuidColumn(Sequelize),
        subject_type: { type: Sequelize.STRING(16), allowNull: false },
        subject_id: uuidColumn(Sequelize),
        status: { type: Sequelize.STRING(16), allowNull: false },
        occurrence_date: { type: Sequelize.DATEONLY, allowNull: false },
        scheduled_start: { type: Sequelize.DATE(3), allowNull: false },
        recorded_by: uuidColumn(Sequelize),
        recorded_by_role: { type: Sequelize.STRING(16), allowNull: false },
        recorded_at: { type: Sequelize.DATE(3), allowNull: false },
        updated_by: uuidColumn(Sequelize),
        updated_by_role: { type: Sequelize.STRING(16), allowNull: false },
        updated_at: { type: Sequelize.DATE(3), allowNull: false },
      },
      TABLE_OPTIONS,
    );
    await queryInterface.addIndex('attendance_records', ['session_id', 'subject_type', 'subject_id'], { unique: true, name: 'uq_attendance_session_subject' });
    await queryInterface.addIndex('attendance_records', ['subject_id', 'scheduled_start'], { name: 'ix_attendance_subject' });
    await queryInterface.sequelize.query("ALTER TABLE attendance_records ADD CONSTRAINT ck_attendance_status CHECK (status IN ('PRESENT', 'ABSENT'))");
    await queryInterface.sequelize.query("ALTER TABLE attendance_records ADD CONSTRAINT ck_attendance_subject_type CHECK (subject_type IN ('STUDENT', 'TEACHER'))");
    await queryInterface.sequelize.query("ALTER TABLE attendance_records ADD CONSTRAINT ck_attendance_roles CHECK (recorded_by_role IN ('TEACHER', 'SCHOOL_MANAGER') AND updated_by_role IN ('TEACHER', 'SCHOOL_MANAGER'))");

    await queryInterface.createTable(
      'attendance_correction_history',
      {
        id: uuidPrimaryKey(Sequelize),
        record_id: uuidColumn(Sequelize),
        session_id: uuidColumn(Sequelize),
        subject_type: { type: Sequelize.STRING(16), allowNull: false },
        subject_id: uuidColumn(Sequelize),
        previous_status: { type: Sequelize.STRING(16), allowNull: false },
        new_status: { type: Sequelize.STRING(16), allowNull: false },
        reason: { type: Sequelize.STRING(500), allowNull: false },
        changed_by: uuidColumn(Sequelize),
        changed_by_role: { type: Sequelize.STRING(16), allowNull: false },
        changed_at: { type: Sequelize.DATE(3), allowNull: false },
      },
      TABLE_OPTIONS,
    );
    await queryInterface.sequelize.query('ALTER TABLE attendance_correction_history ADD COLUMN seq BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, ADD UNIQUE KEY uq_attendance_correction_seq (seq)');
    await queryInterface.addIndex('attendance_correction_history', ['session_id', 'seq'], { name: 'ix_attendance_correction_session' });
    await queryInterface.addIndex('attendance_correction_history', ['record_id', 'seq'], { name: 'ix_attendance_correction_record' });
    await queryInterface.sequelize.query("ALTER TABLE attendance_correction_history ADD CONSTRAINT ck_attendance_correction_status CHECK (previous_status IN ('PRESENT', 'ABSENT') AND new_status IN ('PRESENT', 'ABSENT') AND previous_status <> new_status)");
    await queryInterface.sequelize.query("ALTER TABLE attendance_correction_history ADD CONSTRAINT ck_attendance_correction_reason CHECK (CHAR_LENGTH(TRIM(reason)) > 0)");
    await queryInterface.sequelize.query("ALTER TABLE attendance_correction_history ADD CONSTRAINT ck_attendance_correction_role CHECK (changed_by_role IN ('TEACHER', 'SCHOOL_MANAGER') AND subject_type IN ('STUDENT', 'TEACHER'))");
  },

  async down(queryInterface) {
    await queryInterface.dropTable('attendance_correction_history');
    await queryInterface.dropTable('attendance_records');
  },
};
