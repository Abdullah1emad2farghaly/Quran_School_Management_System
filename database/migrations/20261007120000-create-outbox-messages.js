"use strict";
const { TABLE_OPTIONS, auditTimestamps } = require("../helpers.cjs");

/**
 * Transactional outbox. Rows are written in the same transaction as the
 * business change; a processor delivers them later (at-least-once).
 * Exception to the UUID-primary-key convention: a BIGINT sequence gives a
 * cheap, stable delivery order; the event itself is identified by event_id.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable(
      "outbox_messages",
      {
        id: {
          type: Sequelize.BIGINT.UNSIGNED,
          allowNull: false,
          primaryKey: true,
          autoIncrement: true,
        },
        event_id: { type: Sequelize.CHAR(36), allowNull: false },
        event_type: { type: Sequelize.STRING(150), allowNull: false },
        aggregate_type: { type: Sequelize.STRING(100), allowNull: false },
        aggregate_id: { type: Sequelize.STRING(64), allowNull: false },
        payload: { type: Sequelize.TEXT("long"), allowNull: false },
        metadata: { type: Sequelize.TEXT, allowNull: true },
        occurred_at: { type: Sequelize.DATE(3), allowNull: false },
        status: {
          type: Sequelize.STRING(20),
          allowNull: false,
          defaultValue: "pending",
        },
        attempts: {
          type: Sequelize.INTEGER.UNSIGNED,
          allowNull: false,
          defaultValue: 0,
        },
        next_attempt_at: { type: Sequelize.DATE(3), allowNull: false },
        locked_by: { type: Sequelize.CHAR(36), allowNull: true },
        locked_until: { type: Sequelize.DATE(3), allowNull: true },
        last_error: { type: Sequelize.TEXT, allowNull: true },
        processed_at: { type: Sequelize.DATE(3), allowNull: true },
        ...auditTimestamps(Sequelize),
      },
      TABLE_OPTIONS,
    );
    await queryInterface.addIndex("outbox_messages", ["event_id"], {
      unique: true,
      name: "uq_outbox_messages_event_id",
    });
    await queryInterface.addIndex(
      "outbox_messages",
      ["status", "next_attempt_at"],
      {
        name: "ix_outbox_messages_pending",
      },
    );
  },

  async down(queryInterface) {
    await queryInterface.dropTable("outbox_messages");
  },
};
