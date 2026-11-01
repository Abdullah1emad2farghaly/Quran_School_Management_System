'use strict';
const { TABLE_OPTIONS, uuidPrimaryKey, uuidColumn } = require('../helpers.cjs');

/**
 * Module 28 (Revision, Master Specification §49 and the approved Module 28 decisions). Four tables, no foreign keys to other modules' tables (§14).
 * - revision_assignments: the assignment of the NEXT session, defined during `defined_in_session_id`. `student_id` is NULL for the shared assignment of a GROUP-mode
 *   group. `subject_key` = the student id, or 'GROUP'. `active_slot` is 1 while ACTIVE and NULL after a cancellation, so UNIQUE (defined_in_session_id, subject_key,
 *   active_slot) allows at most ONE active assignment per session and subject while any number of cancelled ones are kept (NULLs do not collide). `range_json` holds the
 *   Module 22 request and result. Never deleted.
 * - revision_assignment_history: APPEND-ONLY; one row per DEFINED / MODIFIED / CANCELLED (the permitted period only). `seq` is the insertion order.
 * - revision_records: one student's revision for one session. NO uniqueness: overlapping ranges, repeated verses and several records in one session are valid.
 *   `assignment_id` is the scheduled assignment it was evaluated against (NULL = none); `matches_assignment` is computed by the system. `session_scheduled_start` is a snapshot
 *   of the session start (ordering, and stable past views). Never deleted.
 * - revision_correction_history: APPEND-ONLY; the previous (original) and new range of every correction. `seq` is the insertion order.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable(
      'revision_assignments',
      {
        id: uuidPrimaryKey(Sequelize),
        school_id: uuidColumn(Sequelize),
        group_id: uuidColumn(Sequelize),
        student_id: { type: Sequelize.CHAR(36), allowNull: true },
        subject_key: { type: Sequelize.CHAR(36), allowNull: false },
        defined_in_session_id: uuidColumn(Sequelize),
        defined_by_teacher_id: uuidColumn(Sequelize),
        defined_by_user_id: uuidColumn(Sequelize),
        range_json: { type: Sequelize.TEXT('long'), allowNull: false },
        status: { type: Sequelize.STRING(16), allowNull: false },
        active_slot: { type: Sequelize.TINYINT, allowNull: true },
        created_at: { type: Sequelize.DATE(3), allowNull: false },
        updated_at: { type: Sequelize.DATE(3), allowNull: false },
      },
      TABLE_OPTIONS,
    );
    await queryInterface.addIndex('revision_assignments', ['defined_in_session_id', 'subject_key', 'active_slot'], { unique: true, name: 'uq_revision_assignment_active' });
    await queryInterface.addIndex('revision_assignments', ['group_id', 'status'], { name: 'ix_revision_assignment_group' });
    await queryInterface.sequelize.query("ALTER TABLE revision_assignments ADD CONSTRAINT ck_revision_assignment_status CHECK (status IN ('ACTIVE', 'CANCELLED'))");
    await queryInterface.sequelize.query("ALTER TABLE revision_assignments ADD CONSTRAINT ck_revision_assignment_slot CHECK ((status = 'ACTIVE' AND COALESCE(active_slot, 0) = 1) OR (status = 'CANCELLED' AND active_slot IS NULL))");

    await queryInterface.createTable(
      'revision_assignment_history',
      {
        id: uuidPrimaryKey(Sequelize),
        assignment_id: uuidColumn(Sequelize),
        session_id: uuidColumn(Sequelize),
        action: { type: Sequelize.STRING(16), allowNull: false },
        previous_range_json: { type: Sequelize.TEXT('long'), allowNull: true },
        new_range_json: { type: Sequelize.TEXT('long'), allowNull: true },
        changed_by: uuidColumn(Sequelize),
        changed_at: { type: Sequelize.DATE(3), allowNull: false },
      },
      TABLE_OPTIONS,
    );
    await queryInterface.sequelize.query('ALTER TABLE revision_assignment_history ADD COLUMN seq BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, ADD UNIQUE KEY uq_revision_assignment_history_seq (seq)');
    await queryInterface.addIndex('revision_assignment_history', ['session_id', 'seq'], { name: 'ix_revision_assignment_history_session' });
    await queryInterface.sequelize.query("ALTER TABLE revision_assignment_history ADD CONSTRAINT ck_revision_assignment_history_action CHECK (action IN ('DEFINED', 'MODIFIED', 'CANCELLED'))");

    await queryInterface.createTable(
      'revision_records',
      {
        id: uuidPrimaryKey(Sequelize),
        session_id: uuidColumn(Sequelize),
        school_id: uuidColumn(Sequelize),
        group_id: uuidColumn(Sequelize),
        student_id: uuidColumn(Sequelize),
        assignment_id: { type: Sequelize.CHAR(36), allowNull: true },
        range_json: { type: Sequelize.TEXT('long'), allowNull: false },
        matches_assignment: { type: Sequelize.TINYINT, allowNull: true },
        session_scheduled_start: { type: Sequelize.DATE(3), allowNull: false },
        recorded_by: uuidColumn(Sequelize),
        recorded_at: { type: Sequelize.DATE(3), allowNull: false },
        updated_by: uuidColumn(Sequelize),
        updated_at: { type: Sequelize.DATE(3), allowNull: false },
      },
      TABLE_OPTIONS,
    );
    await queryInterface.addIndex('revision_records', ['session_id', 'recorded_at'], { name: 'ix_revision_record_session' });
    await queryInterface.addIndex('revision_records', ['student_id', 'session_scheduled_start'], { name: 'ix_revision_record_student' });
    await queryInterface.addIndex('revision_records', ['assignment_id', 'matches_assignment'], { name: 'ix_revision_record_assignment' });
    await queryInterface.sequelize.query('ALTER TABLE revision_records ADD CONSTRAINT ck_revision_record_matches CHECK (matches_assignment IS NULL OR matches_assignment IN (0, 1))');
    await queryInterface.sequelize.query('ALTER TABLE revision_records ADD CONSTRAINT ck_revision_record_assignment CHECK ((assignment_id IS NULL) = (matches_assignment IS NULL))');

    await queryInterface.createTable(
      'revision_correction_history',
      {
        id: uuidPrimaryKey(Sequelize),
        record_id: uuidColumn(Sequelize),
        session_id: uuidColumn(Sequelize),
        student_id: uuidColumn(Sequelize),
        previous_range_json: { type: Sequelize.TEXT('long'), allowNull: false },
        new_range_json: { type: Sequelize.TEXT('long'), allowNull: false },
        previous_matches: { type: Sequelize.TINYINT, allowNull: true },
        new_matches: { type: Sequelize.TINYINT, allowNull: true },
        reason: { type: Sequelize.STRING(500), allowNull: true },
        changed_by: uuidColumn(Sequelize),
        changed_at: { type: Sequelize.DATE(3), allowNull: false },
      },
      TABLE_OPTIONS,
    );
    await queryInterface.sequelize.query('ALTER TABLE revision_correction_history ADD COLUMN seq BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, ADD UNIQUE KEY uq_revision_correction_seq (seq)');
    await queryInterface.addIndex('revision_correction_history', ['session_id', 'seq'], { name: 'ix_revision_correction_session' });
    await queryInterface.addIndex('revision_correction_history', ['record_id', 'seq'], { name: 'ix_revision_correction_record' });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('revision_correction_history');
    await queryInterface.dropTable('revision_records');
    await queryInterface.dropTable('revision_assignment_history');
    await queryInterface.dropTable('revision_assignments');
  },
};
