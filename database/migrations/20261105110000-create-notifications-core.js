'use strict';
const { TABLE_OPTIONS, uuidPrimaryKey, uuidColumn } = require('../helpers.cjs');

/**
 * Module 31 (Notifications Core, Master Specification §62-63 and the approved Module 31 decisions). Additive. No foreign keys to other modules' tables (§14): `recipient_user_id`,
 * `user_id` and `auth_session_id` are plain references validated by the application. The only foreign keys are between this module's own tables.
 * - notifications: one row per recipient ACCOUNT (never per device). The title and body are stored already rendered in the language chosen at creation (Arabic or English).
 *   HARD deleted by the account owner (no deleted_at, no archive); there is no automatic purge.
 * - notification_dedup_keys: the once-only ledger (approved decision Q1). ONLY recipient_user_id, dedup_key and created_at, no content. A row is written BEFORE its notification and is
 *   NEVER deleted, so a retried event or a repeated reminder cannot recreate a notification the user already deleted.
 * - push_subscriptions: a browser/device endpoint linked to the account and to the authentication session that created it. `endpoint_hash` (SHA-256) is the unique key of the endpoint.
 * - push_deliveries: the Web Push queue, one row per (notification, subscription). Deleted when sent; removed with its notification or subscription (ON DELETE CASCADE, own tables only).
 * Every CHECK is written so that a NULL cannot pass by accident.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable(
      'notifications',
      {
        id: uuidPrimaryKey(Sequelize),
        recipient_user_id: uuidColumn(Sequelize),
        type: { type: Sequelize.STRING(64), allowNull: false },
        title: { type: Sequelize.STRING(200), allowNull: false },
        body: { type: Sequelize.TEXT, allowNull: false },
        data: { type: Sequelize.TEXT, allowNull: true },
        read_at: { type: Sequelize.DATE(3), allowNull: true },
        created_at: { type: Sequelize.DATE(3), allowNull: false },
      },
      TABLE_OPTIONS,
    );
    await queryInterface.addIndex('notifications', ['recipient_user_id', 'created_at', 'id'], { name: 'ix_notifications_recipient_created' });
    await queryInterface.addIndex('notifications', ['recipient_user_id', 'read_at'], { name: 'ix_notifications_recipient_read' });
    await queryInterface.sequelize.query("ALTER TABLE notifications ADD CONSTRAINT ck_notifications_text CHECK (CHAR_LENGTH(title) > 0 AND CHAR_LENGTH(body) > 0 AND CHAR_LENGTH(type) > 0)");

    await queryInterface.createTable(
      'notification_dedup_keys',
      {
        recipient_user_id: uuidColumn(Sequelize),
        dedup_key: { type: Sequelize.STRING(191), allowNull: false },
        created_at: { type: Sequelize.DATE(3), allowNull: false },
      },
      TABLE_OPTIONS,
    );
    await queryInterface.sequelize.query('ALTER TABLE notification_dedup_keys ADD PRIMARY KEY (recipient_user_id, dedup_key)');

    await queryInterface.createTable(
      'push_subscriptions',
      {
        id: uuidPrimaryKey(Sequelize),
        user_id: uuidColumn(Sequelize),
        auth_session_id: uuidColumn(Sequelize),
        endpoint: { type: Sequelize.TEXT, allowNull: false },
        endpoint_hash: { type: Sequelize.CHAR(64), allowNull: false },
        p256dh: { type: Sequelize.STRING(255), allowNull: false },
        auth: { type: Sequelize.STRING(255), allowNull: false },
        created_at: { type: Sequelize.DATE(3), allowNull: false },
        updated_at: { type: Sequelize.DATE(3), allowNull: false },
        last_success_at: { type: Sequelize.DATE(3), allowNull: true },
        consecutive_failures: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      },
      TABLE_OPTIONS,
    );
    await queryInterface.addIndex('push_subscriptions', ['endpoint_hash'], { unique: true, name: 'uq_push_subscriptions_endpoint' });
    await queryInterface.addIndex('push_subscriptions', ['user_id'], { name: 'ix_push_subscriptions_user' });
    await queryInterface.addIndex('push_subscriptions', ['auth_session_id'], { name: 'ix_push_subscriptions_session' });
    await queryInterface.sequelize.query('ALTER TABLE push_subscriptions ADD CONSTRAINT ck_push_subscriptions_failures CHECK (consecutive_failures >= 0)');

    await queryInterface.createTable(
      'push_deliveries',
      {
        id: uuidPrimaryKey(Sequelize),
        notification_id: uuidColumn(Sequelize),
        subscription_id: uuidColumn(Sequelize),
        recipient_user_id: uuidColumn(Sequelize),
        status: { type: Sequelize.STRING(10), allowNull: false },
        attempts: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
        next_attempt_at: { type: Sequelize.DATE(3), allowNull: false },
        locked_until: { type: Sequelize.DATE(3), allowNull: true },
        claim_id: { type: Sequelize.CHAR(36), allowNull: true },
        last_error: { type: Sequelize.STRING(100), allowNull: true },
        created_at: { type: Sequelize.DATE(3), allowNull: false },
        failed_at: { type: Sequelize.DATE(3), allowNull: true },
      },
      TABLE_OPTIONS,
    );
    await queryInterface.addIndex('push_deliveries', ['status', 'next_attempt_at'], { name: 'ix_push_deliveries_due' });
    await queryInterface.addIndex('push_deliveries', ['claim_id'], { name: 'ix_push_deliveries_claim' });
    await queryInterface.addIndex('push_deliveries', ['notification_id'], { name: 'ix_push_deliveries_notification' });
    await queryInterface.addIndex('push_deliveries', ['subscription_id'], { name: 'ix_push_deliveries_subscription' });
    await queryInterface.addIndex('push_deliveries', ['recipient_user_id'], { name: 'ix_push_deliveries_recipient' });
    await queryInterface.sequelize.query("ALTER TABLE push_deliveries ADD CONSTRAINT ck_push_deliveries_status CHECK (status IN ('PENDING','FAILED') AND attempts >= 0 AND (status = 'PENDING' OR failed_at IS NOT NULL))");
    await queryInterface.sequelize.query('ALTER TABLE push_deliveries ADD CONSTRAINT fk_push_deliveries_notification FOREIGN KEY (notification_id) REFERENCES notifications (id) ON DELETE CASCADE');
    await queryInterface.sequelize.query('ALTER TABLE push_deliveries ADD CONSTRAINT fk_push_deliveries_subscription FOREIGN KEY (subscription_id) REFERENCES push_subscriptions (id) ON DELETE CASCADE');
  },

  /** Drops this module's own tables (children first). Notifications are user data: run this only on purpose. */
  async down(queryInterface) {
    await queryInterface.dropTable('push_deliveries');
    await queryInterface.dropTable('push_subscriptions');
    await queryInterface.dropTable('notification_dedup_keys');
    await queryInterface.dropTable('notifications');
  },
};
