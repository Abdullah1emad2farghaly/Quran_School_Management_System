'use strict';
const { TABLE_OPTIONS, uuidPrimaryKey, uuidColumn } = require('../helpers.cjs');

/**
 * Module 32 (Notification Rules, Master Specification §57, §63 and the approved Module 32 decisions). Additive. No foreign keys to other modules' tables (§14): `subject_id` and
 * `exam_id` / `subject_id` are plain references validated by the application. Nothing existing is altered.
 * - notification_reminders: the TIME-DRIVEN reminders, one row per (kind, subject). kind EXAM_24H (subject = exam id), SESSION_HALF_TIME and SESSION_EVALUATION (subject = class session id).
 *   `due_at` is when it becomes due; the worker claims due PENDING rows (`locked_until` / `claim_id` are the lock), re-checks the current facts and sets state SENT, SUPPRESSED or FAILED.
 *   Because the work is due-based, a delayed scheduler or a restart just finds the rows already due and sends them late, when the approved conditions still hold.
 * - notification_exam_audience: the students (role STUDENT) and examiners' Teacher ids (role EXAMINER) Module 32 has told about an exam. It lets a change of targets tell the parents
 *   who were removed and lets a cancelled or deleted exam still reach its parents and examiners. Cleared when the exam is cancelled, deleted or ended.
 * Rollback (`down`) drops both tables; it loses only pending reminders and the audience snapshot, never a notification (Module 31 owns those).
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable(
      'notification_reminders',
      {
        id: uuidPrimaryKey(Sequelize),
        kind: { type: Sequelize.STRING(30), allowNull: false },
        subject_id: uuidColumn(Sequelize),
        due_at: { type: Sequelize.DATE(3), allowNull: false },
        state: { type: Sequelize.STRING(12), allowNull: false, defaultValue: 'PENDING' },
        attempts: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
        locked_until: { type: Sequelize.DATE(3), allowNull: true },
        claim_id: { type: Sequelize.CHAR(36), allowNull: true },
        last_error: { type: Sequelize.STRING(191), allowNull: true },
        processed_at: { type: Sequelize.DATE(3), allowNull: true },
        created_at: { type: Sequelize.DATE(3), allowNull: false },
        updated_at: { type: Sequelize.DATE(3), allowNull: false },
      },
      TABLE_OPTIONS,
    );
    await queryInterface.addIndex('notification_reminders', ['kind', 'subject_id'], { unique: true, name: 'ux_notification_reminders_kind_subject' });
    await queryInterface.addIndex('notification_reminders', ['state', 'due_at'], { name: 'ix_notification_reminders_state_due' });
    await queryInterface.addIndex('notification_reminders', ['claim_id'], { name: 'ix_notification_reminders_claim' });
    await queryInterface.addIndex('notification_reminders', ['subject_id'], { name: 'ix_notification_reminders_subject' });
    await queryInterface.sequelize.query(
      "ALTER TABLE notification_reminders ADD CONSTRAINT ck_notification_reminders_kind CHECK (kind IN ('EXAM_24H', 'SESSION_HALF_TIME', 'SESSION_EVALUATION'))",
    );
    await queryInterface.sequelize.query(
      "ALTER TABLE notification_reminders ADD CONSTRAINT ck_notification_reminders_state CHECK (state IN ('PENDING', 'SENT', 'SUPPRESSED', 'FAILED'))",
    );

    await queryInterface.createTable(
      'notification_exam_audience',
      {
        exam_id: uuidColumn(Sequelize),
        role: { type: Sequelize.STRING(10), allowNull: false },
        subject_id: uuidColumn(Sequelize),
        created_at: { type: Sequelize.DATE(3), allowNull: false },
      },
      TABLE_OPTIONS,
    );
    await queryInterface.sequelize.query('ALTER TABLE notification_exam_audience ADD PRIMARY KEY (exam_id, role, subject_id)');
    await queryInterface.sequelize.query("ALTER TABLE notification_exam_audience ADD CONSTRAINT ck_notification_exam_audience_role CHECK (role IN ('STUDENT', 'EXAMINER'))");
  },

  async down(queryInterface) {
    await queryInterface.dropTable('notification_exam_audience');
    await queryInterface.dropTable('notification_reminders');
  },
};
