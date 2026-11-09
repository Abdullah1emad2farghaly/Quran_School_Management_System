'use strict';
const { TABLE_OPTIONS, uuidPrimaryKey, uuidColumn, auditTimestamps } = require('../helpers.cjs');

/**
 * Module 33 (Subscriptions). Three tables, no foreign keys to other modules' tables (Master Specification §14); the one key below points only at this module's own batches table.
 * - subscription_batches: one row per (school, month) that had its monthly BULK creation done. UNIQUE (school_id, month) is the concurrency guard of the bulk operation
 *   (two simultaneous runs: exactly one wins) and the answer to "were the subscriptions of this month already created".
 * - subscriptions: Student + Month + Status and nothing else (no amount, no proration). UNIQUE (student_id, month) forbids a duplicate for the same student and month, for bulk and
 *   individual creation alike. month is `YYYY-MM` (Africa/Cairo); that text sorts chronologically, which the Oldest-Unpaid Rule uses. The status CHECKs keep the paid /
 *   waived audit columns consistent with the status.
 * - collector_school_links: the Subscription Collector-to-School relationship with history (never deleted). `active` is 1 while current and NULL once removed, so
 *   (user_id, school_id, active) allows ONE active link per school and any number of ended ones. The CHECK uses the NULL-safe `<=>`.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable(
      'subscription_batches',
      {
        id: uuidPrimaryKey(Sequelize),
        school_id: uuidColumn(Sequelize),
        organization_id: uuidColumn(Sequelize),
        month: { type: Sequelize.CHAR(7), allowNull: false },
        record_count: { type: Sequelize.INTEGER.UNSIGNED, allowNull: false },
        created_by: uuidColumn(Sequelize),
        ...auditTimestamps(Sequelize),
      },
      TABLE_OPTIONS,
    );
    await queryInterface.addIndex('subscription_batches', ['school_id', 'month'], { unique: true, name: 'uq_subscription_batches_school_month' });
    await queryInterface.sequelize.query("ALTER TABLE subscription_batches ADD CONSTRAINT ck_subscription_batches_month CHECK (month REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])$')");

    await queryInterface.createTable(
      'subscriptions',
      {
        id: uuidPrimaryKey(Sequelize),
        student_id: uuidColumn(Sequelize),
        school_id: uuidColumn(Sequelize),
        organization_id: uuidColumn(Sequelize),
        month: { type: Sequelize.CHAR(7), allowNull: false },
        status: { type: Sequelize.STRING(10), allowNull: false },
        batch_id: uuidColumn(Sequelize, { allowNull: true, references: { model: 'subscription_batches', key: 'id' }, onDelete: 'RESTRICT', onUpdate: 'RESTRICT' }),
        created_by: uuidColumn(Sequelize),
        paid_at: { type: Sequelize.DATE(3), allowNull: true },
        paid_by: uuidColumn(Sequelize, { allowNull: true }),
        waived_at: { type: Sequelize.DATE(3), allowNull: true },
        waived_by: uuidColumn(Sequelize, { allowNull: true }),
        version: { type: Sequelize.INTEGER.UNSIGNED, allowNull: false, defaultValue: 1 },
        ...auditTimestamps(Sequelize),
      },
      TABLE_OPTIONS,
    );
    await queryInterface.addIndex('subscriptions', ['student_id', 'month'], { unique: true, name: 'uq_subscriptions_student_month' });
    await queryInterface.addIndex('subscriptions', ['school_id', 'month', 'status'], { name: 'ix_subscriptions_school_month_status' });
    await queryInterface.addIndex('subscriptions', ['batch_id'], { name: 'ix_subscriptions_batch' });
    await queryInterface.sequelize.query("ALTER TABLE subscriptions ADD CONSTRAINT ck_subscriptions_month CHECK (month REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])$')");
    await queryInterface.sequelize.query("ALTER TABLE subscriptions ADD CONSTRAINT ck_subscriptions_status CHECK (status IN ('PAID', 'UNPAID', 'WAIVED'))");
    await queryInterface.sequelize.query(
      `ALTER TABLE subscriptions ADD CONSTRAINT ck_subscriptions_audit CHECK (
         (status = 'UNPAID' AND paid_at IS NULL AND paid_by IS NULL AND waived_at IS NULL AND waived_by IS NULL)
         OR (status = 'PAID' AND paid_at IS NOT NULL AND paid_by IS NOT NULL AND waived_at IS NULL AND waived_by IS NULL)
         OR (status = 'WAIVED' AND waived_at IS NOT NULL AND waived_by IS NOT NULL AND paid_at IS NULL AND paid_by IS NULL))`,
    );

    await queryInterface.createTable(
      'collector_school_links',
      {
        id: uuidPrimaryKey(Sequelize),
        user_id: uuidColumn(Sequelize),
        organization_id: uuidColumn(Sequelize),
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
    await queryInterface.addIndex('collector_school_links', ['user_id', 'school_id', 'active'], { unique: true, name: 'uq_collector_school_links_active' });
    await queryInterface.addIndex('collector_school_links', ['school_id', 'active'], { name: 'ix_collector_school_links_school' });
    await queryInterface.addIndex('collector_school_links', ['user_id'], { name: 'ix_collector_school_links_user' });
    await queryInterface.sequelize.query(
      'ALTER TABLE collector_school_links ADD CONSTRAINT ck_collector_school_links_active CHECK ((active <=> 1 AND unlinked_at IS NULL AND unlinked_by IS NULL) OR (active IS NULL AND unlinked_at IS NOT NULL AND unlinked_by IS NOT NULL))',
    );
  },

  async down(queryInterface) {
    await queryInterface.dropTable('collector_school_links');
    await queryInterface.dropTable('subscriptions');
    await queryInterface.dropTable('subscription_batches');
  },
};
