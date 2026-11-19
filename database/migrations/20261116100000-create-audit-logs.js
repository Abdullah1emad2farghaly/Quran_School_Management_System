'use strict';
const { TABLE_OPTIONS, uuidPrimaryKey, uuidColumn } = require('../helpers.cjs');

/**
 * Module 35 (History & Audit). One table, no foreign keys to other modules' tables (Master Specification §14).
 * - audit_logs: the immutable audit trail (§64: actor, action, module, entity, before, after, ip, user agent, timestamp; retention: indefinite).
 *   `event_id` is UNIQUE (an at-least-once redelivery cannot write a second record). `organization_id` / `school_id` carry the scope that decides who may read a record.
 *   There is deliberately NO updated_at and no soft-delete column: a record is never changed.
 * - Immutability is enforced by the database too: BEFORE UPDATE and BEFORE DELETE triggers reject any change. If the database user may not create triggers, the
 *   migration still succeeds and prints a warning (the application never updates or deletes either); the owner should then grant TRIGGER and re-run `npm run db:migrate:undo`/`db:migrate`
 *   or create the two triggers by hand (docs/AUDIT.md).
 * No existing table is changed.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable(
      'audit_logs',
      {
        id: uuidPrimaryKey(Sequelize),
        event_id: uuidColumn(Sequelize),
        actor_user_id: uuidColumn(Sequelize, { allowNull: true }),
        action: { type: Sequelize.STRING(32), allowNull: false },
        module: { type: Sequelize.STRING(40), allowNull: false },
        entity_type: { type: Sequelize.STRING(80), allowNull: false },
        entity_id: { type: Sequelize.STRING(64), allowNull: false },
        before_json: { type: Sequelize.TEXT('long'), allowNull: true },
        after_json: { type: Sequelize.TEXT('long'), allowNull: true },
        ip_address: { type: Sequelize.STRING(64), allowNull: true },
        user_agent: { type: Sequelize.STRING(255), allowNull: true },
        request_id: { type: Sequelize.STRING(64), allowNull: true },
        organization_id: uuidColumn(Sequelize, { allowNull: true }),
        school_id: uuidColumn(Sequelize, { allowNull: true }),
        occurred_at: { type: Sequelize.DATE(3), allowNull: false },
        recorded_at: { type: Sequelize.DATE(3), allowNull: false },
      },
      TABLE_OPTIONS,
    );
    await queryInterface.addIndex('audit_logs', ['event_id'], { name: 'ux_audit_logs_event', unique: true });
    await queryInterface.addIndex('audit_logs', ['occurred_at', 'id'], { name: 'ix_audit_logs_time' });
    await queryInterface.addIndex('audit_logs', ['organization_id', 'occurred_at'], { name: 'ix_audit_logs_organization' });
    await queryInterface.addIndex('audit_logs', ['school_id', 'occurred_at'], { name: 'ix_audit_logs_school' });
    await queryInterface.addIndex('audit_logs', ['entity_type', 'entity_id'], { name: 'ix_audit_logs_entity' });
    await queryInterface.addIndex('audit_logs', ['actor_user_id', 'occurred_at'], { name: 'ix_audit_logs_actor' });
    await queryInterface.addIndex('audit_logs', ['module', 'action', 'occurred_at'], { name: 'ix_audit_logs_module_action' });

    try {
      await queryInterface.sequelize.query(
        "CREATE TRIGGER audit_logs_no_update BEFORE UPDATE ON audit_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_logs is append-only'",
      );
      await queryInterface.sequelize.query(
        "CREATE TRIGGER audit_logs_no_delete BEFORE DELETE ON audit_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_logs is append-only'",
      );
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn(`WARNING: could not create the append-only triggers on audit_logs (${error.message}). The table works, but the database does not itself reject UPDATE/DELETE.`);
    }
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query('DROP TRIGGER IF EXISTS audit_logs_no_update');
    await queryInterface.sequelize.query('DROP TRIGGER IF EXISTS audit_logs_no_delete');
    await queryInterface.dropTable('audit_logs');
  },
};
