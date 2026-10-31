'use strict';

/**
 * Module 26: the project owner approved ONE automatic attendance rule: a Teacher who has not recorded their attendance when the session is COMPLETED, or who cancels the
 * session, is ABSENT in it. The system records it, so the actor role 'SYSTEM' (user id: the nil UUID) must be accepted. This only widens the role CHECK constraints of
 * create-attendance (all the columns are NOT NULL, so no CHECK can pass on a NULL); the earlier migration is left untouched (migration history is never rewritten).
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query('ALTER TABLE attendance_records DROP CONSTRAINT ck_attendance_roles');
    await queryInterface.sequelize.query("ALTER TABLE attendance_records ADD CONSTRAINT ck_attendance_roles CHECK (recorded_by_role IN ('TEACHER', 'SCHOOL_MANAGER', 'SYSTEM') AND updated_by_role IN ('TEACHER', 'SCHOOL_MANAGER', 'SYSTEM'))");
    await queryInterface.sequelize.query('ALTER TABLE attendance_correction_history DROP CONSTRAINT ck_attendance_correction_role');
    await queryInterface.sequelize.query("ALTER TABLE attendance_correction_history ADD CONSTRAINT ck_attendance_correction_role CHECK (changed_by_role IN ('TEACHER', 'SCHOOL_MANAGER', 'SYSTEM') AND subject_type IN ('STUDENT', 'TEACHER'))");
  },

  async down(queryInterface) {
    // Rows written by the system would violate the narrower constraint: refuse to roll back while any exist (nothing is ever deleted or rewritten).
    const [[recs]] = await queryInterface.sequelize.query("SELECT COUNT(*) AS n FROM attendance_records WHERE recorded_by_role = 'SYSTEM' OR updated_by_role = 'SYSTEM'");
    const [[hist]] = await queryInterface.sequelize.query("SELECT COUNT(*) AS n FROM attendance_correction_history WHERE changed_by_role = 'SYSTEM'");
    if (Number(recs.n) > 0 || Number(hist.n) > 0) throw new Error('Cannot roll back: attendance rows recorded by the SYSTEM exist.');
    await queryInterface.sequelize.query('ALTER TABLE attendance_records DROP CONSTRAINT ck_attendance_roles');
    await queryInterface.sequelize.query("ALTER TABLE attendance_records ADD CONSTRAINT ck_attendance_roles CHECK (recorded_by_role IN ('TEACHER', 'SCHOOL_MANAGER') AND updated_by_role IN ('TEACHER', 'SCHOOL_MANAGER'))");
    await queryInterface.sequelize.query('ALTER TABLE attendance_correction_history DROP CONSTRAINT ck_attendance_correction_role');
    await queryInterface.sequelize.query("ALTER TABLE attendance_correction_history ADD CONSTRAINT ck_attendance_correction_role CHECK (changed_by_role IN ('TEACHER', 'SCHOOL_MANAGER') AND subject_type IN ('STUDENT', 'TEACHER'))");
  },
};
