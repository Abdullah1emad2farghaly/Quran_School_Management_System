'use strict';
const { TABLE_OPTIONS, uuidColumn, uuidPrimaryKey, auditTimestamps } = require('../helpers.cjs');

/**
 * Module 11 (OTP & Password Recovery), Master Specification §26.
 *
 * password_recoveries: one row per OTP issued to an existing, active user. The OTP and the reset token are stored only as
 *   keyed HASHES (HMAC with OTP_HMAC_SECRET); the otp_hash is bound to the row id. `live` is 1 while the row is PENDING or
 *   VERIFIED and NULL once closed; the unique index (user_id, live) allows only ONE live recovery per user (a resend
 *   supersedes the previous one). Rows are kept (history); purge old closed rows with the repository's purgeOlderThan.
 *
 * password_recovery_requests: one row per OTP REQUEST for any phone (existing or not). Only keyed hashes of the phone and the
 *   IP are stored. Used for the rolling-window limits (4 per phone per hour, 5 per phone+IP per 15 minutes).
 *
 * password_recovery_locks: one row per phone hash, used only as a mutex: the request path takes an exclusive row lock so
 *   concurrent requests for the same phone are serialized and cannot race past the limits.
 *
 * The CHECKs use null-safe comparisons (a CHECK only rejects a row when it is FALSE, never when UNKNOWN).
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable(
      'password_recoveries',
      {
        id: uuidPrimaryKey(Sequelize),
        user_id: uuidColumn(Sequelize),
        otp_hash: { type: Sequelize.CHAR(64), allowNull: false },
        attempts: { type: Sequelize.TINYINT.UNSIGNED, allowNull: false, defaultValue: 0 },
        otp_expires_at: { type: Sequelize.DATE(3), allowNull: false },
        status: { type: Sequelize.STRING(16), allowNull: false, defaultValue: 'PENDING' },
        live: { type: Sequelize.TINYINT(1), allowNull: true },
        reset_token_hash: { type: Sequelize.CHAR(64), allowNull: true },
        reset_token_expires_at: { type: Sequelize.DATE(3), allowNull: true },
        verified_at: { type: Sequelize.DATE(3), allowNull: true },
        closed_at: { type: Sequelize.DATE(3), allowNull: true },
        version: { type: Sequelize.INTEGER.UNSIGNED, allowNull: false, defaultValue: 1 },
        ...auditTimestamps(Sequelize),
      },
      TABLE_OPTIONS,
    );
    await queryInterface.addIndex('password_recoveries', ['user_id', 'live'], { unique: true, name: 'uq_password_recoveries_user_live' });
    await queryInterface.addIndex('password_recoveries', ['reset_token_hash'], { unique: true, name: 'uq_password_recoveries_reset_token' });
    await queryInterface.sequelize.query(
      `ALTER TABLE password_recoveries ADD CONSTRAINT ck_password_recoveries_status CHECK (
         status IN ('PENDING','VERIFIED','CONSUMED','SUPERSEDED','LOCKED'))`,
    );
    await queryInterface.sequelize.query(
      `ALTER TABLE password_recoveries ADD CONSTRAINT ck_password_recoveries_live CHECK (
         (live <=> 1 AND status IN ('PENDING','VERIFIED') AND closed_at IS NULL)
         OR (live IS NULL AND status IN ('CONSUMED','SUPERSEDED','LOCKED') AND closed_at IS NOT NULL))`,
    );
    await queryInterface.sequelize.query(
      'ALTER TABLE password_recoveries ADD CONSTRAINT ck_password_recoveries_attempts CHECK (attempts <= 5)',
    );
    await queryInterface.sequelize.query(
      `ALTER TABLE password_recoveries ADD CONSTRAINT ck_password_recoveries_token CHECK (
         status NOT IN ('VERIFIED','CONSUMED') OR (reset_token_hash IS NOT NULL AND reset_token_expires_at IS NOT NULL))`,
    );

    await queryInterface.createTable(
      'password_recovery_requests',
      {
        id: { type: Sequelize.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true, allowNull: false },
        phone_key: { type: Sequelize.CHAR(64), allowNull: false },
        ip_key: { type: Sequelize.CHAR(64), allowNull: false },
        requested_at: { type: Sequelize.DATE(3), allowNull: false },
      },
      TABLE_OPTIONS,
    );
    await queryInterface.addIndex('password_recovery_requests', ['phone_key', 'requested_at'], { name: 'ix_password_recovery_requests_phone_time' });

    await queryInterface.createTable(
      'password_recovery_locks',
      {
        phone_key: { type: Sequelize.CHAR(64), primaryKey: true, allowNull: false },
        touched_at: { type: Sequelize.DATE(3), allowNull: false },
      },
      TABLE_OPTIONS,
    );
  },

  async down(queryInterface) {
    await queryInterface.dropTable('password_recovery_locks');
    await queryInterface.dropTable('password_recovery_requests');
    await queryInterface.dropTable('password_recoveries');
  },
};
