'use strict';
const { TABLE_OPTIONS, uuidPrimaryKey, uuidColumn } = require('../helpers.cjs');

/**
 * Module 23 (Group Schedules). Two tables, no foreign keys to other modules' tables (Master Specification §14).
 * - group_schedule_slots: one row per recurring weekly slot of a group (the weekday and a start and an end). `group_id` and `school_id` are plain references
 *   to Module 20 data (validated by the application in the same transaction). Slots are IMMUTABLE and never deleted: a change retires the old slot
 *   (REPLACED) and inserts a new one, a removal retires it (REMOVED), archiving the group retires them (GROUP_ARCHIVED). `day_of_week` is the ISO weekday
 *   (Monday 1 ... Sunday 7); the times are local wall-clock minutes since midnight (no zone), the end after the start on the same day.
 *   `active` is 1 while the slot is current and NULL once retired, so the unique index (group_id, day_of_week, active) allows ONE active slot per weekday
 *   for a group (whatever the times) and any number of retired ones. `seq` is the insertion order (the history order).
 *   `teacher_id` is the Teacher of the slot's group right now (NULL when the group has none), kept in step by Module 23 (set when a slot is created, updated when
 *   Module 20 changes the group's Teacher). It lets the Teacher conflict check read and lock only this module's own rows; it is not part of the history.
 * - schedule_teacher_locks: one row per Teacher, taken FOR UPDATE (INSERT ... ON DUPLICATE KEY UPDATE) before a Teacher's schedule is checked or changed, so
 *   two concurrent requests for the same Teacher are serialized and the overlap check is concurrency-safe. It holds no business data.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable(
      'group_schedule_slots',
      {
        id: uuidPrimaryKey(Sequelize),
        group_id: uuidColumn(Sequelize),
        school_id: uuidColumn(Sequelize),
        teacher_id: uuidColumn(Sequelize, { allowNull: true }),
        day_of_week: { type: Sequelize.TINYINT.UNSIGNED, allowNull: false },
        start_minute: { type: Sequelize.SMALLINT.UNSIGNED, allowNull: false },
        end_minute: { type: Sequelize.SMALLINT.UNSIGNED, allowNull: false },
        active: { type: Sequelize.TINYINT, allowNull: true },
        created_at: { type: Sequelize.DATE(3), allowNull: false },
        created_by: uuidColumn(Sequelize),
        retired_at: { type: Sequelize.DATE(3), allowNull: true },
        retired_by: uuidColumn(Sequelize, { allowNull: true }),
        retire_reason: { type: Sequelize.STRING(16), allowNull: true },
        replaced_by_slot_id: uuidColumn(Sequelize, { allowNull: true }),
      },
      TABLE_OPTIONS,
    );
    await queryInterface.sequelize.query('ALTER TABLE group_schedule_slots ADD COLUMN seq BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, ADD UNIQUE KEY uq_group_schedule_slots_seq (seq)');
    await queryInterface.addIndex('group_schedule_slots', ['group_id', 'day_of_week', 'active'], { unique: true, name: 'uq_group_schedule_slots_day' });
    await queryInterface.addIndex('group_schedule_slots', ['group_id', 'active'], { name: 'ix_group_schedule_slots_group' });
    await queryInterface.addIndex('group_schedule_slots', ['teacher_id', 'active'], { name: 'ix_group_schedule_slots_teacher' });
    await queryInterface.sequelize.query('ALTER TABLE group_schedule_slots ADD CONSTRAINT ck_group_schedule_slots_day CHECK (day_of_week BETWEEN 1 AND 7)');
    await queryInterface.sequelize.query('ALTER TABLE group_schedule_slots ADD CONSTRAINT ck_group_schedule_slots_times CHECK (start_minute BETWEEN 0 AND 1438 AND end_minute BETWEEN 1 AND 1439 AND start_minute < end_minute)');
    await queryInterface.sequelize.query(
      "ALTER TABLE group_schedule_slots ADD CONSTRAINT ck_group_schedule_slots_retirement CHECK ((active <=> 1 AND retired_at IS NULL AND retired_by IS NULL AND retire_reason IS NULL AND replaced_by_slot_id IS NULL) OR (active IS NULL AND retired_at IS NOT NULL AND retired_by IS NOT NULL AND ((retire_reason = 'REPLACED' AND replaced_by_slot_id IS NOT NULL) OR (retire_reason IN ('REMOVED', 'GROUP_ARCHIVED') AND replaced_by_slot_id IS NULL))))",
    );

    await queryInterface.createTable(
      'schedule_teacher_locks',
      {
        teacher_id: uuidPrimaryKey(Sequelize),
        locked_at: { type: Sequelize.DATE(3), allowNull: false },
      },
      TABLE_OPTIONS,
    );
  },

  async down(queryInterface) {
    await queryInterface.dropTable('schedule_teacher_locks');
    await queryInterface.dropTable('group_schedule_slots');
  },
};
