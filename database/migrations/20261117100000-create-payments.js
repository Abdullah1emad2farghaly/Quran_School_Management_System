'use strict';
const { TABLE_OPTIONS, uuidPrimaryKey, uuidColumn, auditTimestamps } = require('../helpers.cjs');

/**
 * Module 34 (Payments & Collection), Master Specification §60-§61. One table, no foreign keys to other modules' tables (§14); subscription_id, student_id, school_id and
 * organization_id are plain identifiers read through Module 33's public contract.
 * - payments: a cash payment of ONE subscription (Student + School + Subscription). CASH ONLY (CHECK). No amount column: the amount is determined outside the system (§58).
 *   A payment is never deleted (there is no delete statement anywhere); a reversal keeps the row and records reason + actor + time.
 *   `active` is 1 while the payment is SUCCESSFUL and NULL once it is REVERSED, so UNIQUE (subscription_id, active) allows exactly ONE successful payment per subscription (§60) and any
 *   number of reversed ones (MariaDB unique indexes ignore NULLs; the same technique as collector_school_links). The CHECKs keep the reversal columns consistent with the status; method and status are compared as BINARY so 'cash ' or 'Cash' can never pass the CASH-only rule under the case-insensitive, space-padded default collation.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable(
      'payments',
      {
        id: uuidPrimaryKey(Sequelize),
        subscription_id: uuidColumn(Sequelize),
        student_id: uuidColumn(Sequelize),
        school_id: uuidColumn(Sequelize),
        organization_id: uuidColumn(Sequelize),
        month: { type: Sequelize.CHAR(7), allowNull: false },
        method: { type: Sequelize.STRING(10), allowNull: false },
        status: { type: Sequelize.STRING(12), allowNull: false },
        active: { type: Sequelize.TINYINT, allowNull: true },
        recorded_by: uuidColumn(Sequelize),
        recorded_at: { type: Sequelize.DATE(3), allowNull: false },
        reversed_by: uuidColumn(Sequelize, { allowNull: true }),
        reversed_at: { type: Sequelize.DATE(3), allowNull: true },
        reversal_reason: { type: Sequelize.STRING(500), allowNull: true },
        version: { type: Sequelize.INTEGER.UNSIGNED, allowNull: false, defaultValue: 1 },
        ...auditTimestamps(Sequelize),
      },
      TABLE_OPTIONS,
    );
    await queryInterface.addIndex('payments', ['subscription_id', 'active'], { unique: true, name: 'uq_payments_subscription_active' });
    await queryInterface.addIndex('payments', ['school_id', 'month', 'status'], { name: 'ix_payments_school_month_status' });
    await queryInterface.addIndex('payments', ['school_id', 'recorded_at'], { name: 'ix_payments_school_recorded' });
    await queryInterface.addIndex('payments', ['student_id', 'month'], { name: 'ix_payments_student_month' });
    await queryInterface.sequelize.query("ALTER TABLE payments ADD CONSTRAINT ck_payments_month CHECK (month REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])$')");
    await queryInterface.sequelize.query("ALTER TABLE payments ADD CONSTRAINT ck_payments_method CHECK (CAST(method AS BINARY) = 'CASH')");
    await queryInterface.sequelize.query("ALTER TABLE payments ADD CONSTRAINT ck_payments_status CHECK (CAST(status AS BINARY) IN ('SUCCESSFUL', 'REVERSED'))");
    await queryInterface.sequelize.query(
      `ALTER TABLE payments ADD CONSTRAINT ck_payments_reversal CHECK (
         (status = 'SUCCESSFUL' AND active <=> 1 AND reversed_by IS NULL AND reversed_at IS NULL AND reversal_reason IS NULL)
         OR (status = 'REVERSED' AND active IS NULL AND reversed_by IS NOT NULL AND reversed_at IS NOT NULL AND reversal_reason IS NOT NULL AND CHAR_LENGTH(TRIM(reversal_reason)) > 0))`,
    );
  },

  async down(queryInterface) {
    await queryInterface.dropTable('payments');
  },
};
