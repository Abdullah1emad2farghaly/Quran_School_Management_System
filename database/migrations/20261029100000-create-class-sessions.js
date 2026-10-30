'use strict';
const { TABLE_OPTIONS, uuidPrimaryKey, uuidColumn } = require('../helpers.cjs');

/**
 * Module 24 (Class Sessions). One table, no foreign keys to other modules' tables (Master Specification §14).
 * - class_sessions: one row per OCCURRENCE of a group's schedule slot (Module 23), created by the system 15 minutes before its scheduled start. `school_id`, `group_id`,
 *   `teacher_id` and `slot_id` are plain references to Module 20 / 18 / 23 data (validated by the application when the session is created). `occurrence_date` is the
 *   calendar date in the business zone (Africa/Cairo); `scheduled_start` / `scheduled_end` are UTC instants derived from the slot. The unique index (slot_id,
 *   occurrence_date) means one session per occurrence: generation is idempotent. Slots are immutable, so a slot id plus a date identify an occurrence for good.
 *   Sessions are NEVER deleted. A session is created OPEN; the system moves it to IN_PROGRESS and COMPLETED; it may be CANCELLED by its Teacher (with a
 *   non-empty reason; who and when recorded) or by the system because its slot was retired before the start (the retirement reason recorded, no actor).
 *   The CHECK constraints keep status, transition times and the cancellation columns consistent (a CANCELLED row always says who or what cancelled it).
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable(
      'class_sessions',
      {
        id: uuidPrimaryKey(Sequelize),
        school_id: uuidColumn(Sequelize),
        group_id: uuidColumn(Sequelize),
        teacher_id: uuidColumn(Sequelize),
        slot_id: uuidColumn(Sequelize),
        occurrence_date: { type: Sequelize.DATEONLY, allowNull: false },
        scheduled_start: { type: Sequelize.DATE(3), allowNull: false },
        scheduled_end: { type: Sequelize.DATE(3), allowNull: false },
        status: { type: Sequelize.STRING(16), allowNull: false },
        created_at: { type: Sequelize.DATE(3), allowNull: false },
        started_at: { type: Sequelize.DATE(3), allowNull: true },
        completed_at: { type: Sequelize.DATE(3), allowNull: true },
        cancelled_at: { type: Sequelize.DATE(3), allowNull: true },
        cancelled_by: uuidColumn(Sequelize, { allowNull: true }),
        cancel_source: { type: Sequelize.STRING(32), allowNull: true },
        cancel_reason: { type: Sequelize.STRING(500), allowNull: true },
        slot_retire_reason: { type: Sequelize.STRING(16), allowNull: true },
      },
      TABLE_OPTIONS,
    );
    await queryInterface.addIndex('class_sessions', ['slot_id', 'occurrence_date'], { unique: true, name: 'uq_class_sessions_occurrence' });
    await queryInterface.addIndex('class_sessions', ['status', 'scheduled_start'], { name: 'ix_class_sessions_status_start' });
    await queryInterface.addIndex('class_sessions', ['status', 'scheduled_end'], { name: 'ix_class_sessions_status_end' });
    await queryInterface.addIndex('class_sessions', ['group_id', 'scheduled_start'], { name: 'ix_class_sessions_group' });
    await queryInterface.addIndex('class_sessions', ['teacher_id', 'scheduled_start'], { name: 'ix_class_sessions_teacher' });
    await queryInterface.sequelize.query("ALTER TABLE class_sessions ADD CONSTRAINT ck_class_sessions_status CHECK (status IN ('SCHEDULED', 'OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'))");
    await queryInterface.sequelize.query('ALTER TABLE class_sessions ADD CONSTRAINT ck_class_sessions_times CHECK (scheduled_start < scheduled_end)');
    await queryInterface.sequelize.query(
      "ALTER TABLE class_sessions ADD CONSTRAINT ck_class_sessions_progress CHECK ((status IN ('SCHEDULED', 'OPEN') AND started_at IS NULL AND completed_at IS NULL) OR (status = 'IN_PROGRESS' AND started_at IS NOT NULL AND completed_at IS NULL) OR (status = 'COMPLETED' AND started_at IS NOT NULL AND completed_at IS NOT NULL) OR status = 'CANCELLED')",
    );
    await queryInterface.sequelize.query(
      "ALTER TABLE class_sessions ADD CONSTRAINT ck_class_sessions_cancellation CHECK ((status <> 'CANCELLED' AND cancelled_at IS NULL AND cancelled_by IS NULL AND cancel_source IS NULL AND cancel_reason IS NULL AND slot_retire_reason IS NULL) OR (status = 'CANCELLED' AND cancelled_at IS NOT NULL AND ((cancel_source = 'TEACHER' AND cancelled_by IS NOT NULL AND cancel_reason IS NOT NULL AND CHAR_LENGTH(TRIM(cancel_reason)) > 0 AND slot_retire_reason IS NULL) OR (cancel_source = 'SCHEDULE_SLOT_RETIRED' AND cancelled_by IS NULL AND cancel_reason IS NULL AND slot_retire_reason IN ('REPLACED', 'REMOVED', 'GROUP_ARCHIVED')))))",
    );
  },

  async down(queryInterface) {
    await queryInterface.dropTable('class_sessions');
  },
};
