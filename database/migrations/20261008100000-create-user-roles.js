'use strict';
const { TABLE_OPTIONS, uuidColumn, uuidPrimaryKey, auditTimestamps } = require('../helpers.cjs');

/**
 * Module 09 (Roles & Permissions): role assignments with full history (Master Specification §19).
 * - One row per assignment; rows are never deleted (history is preserved).
 * - active = 1 while the assignment is current and NULL once revoked. The unique index on
 *   (user_id, role_code, active) therefore allows only ONE active assignment per user and role, but any
 *   number of revoked ones (NULLs are distinct in a unique index).
 * - The CHECK on role_code is the V1 role list (§18). STUDENT is excluded: Student has no login.
 * - No foreign key to users: each module owns its tables (§14); the service validates the user instead.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable(
      'user_roles',
      {
        id: uuidPrimaryKey(Sequelize),
        user_id: uuidColumn(Sequelize),
        role_code: { type: Sequelize.STRING(32), allowNull: false },
        assigned_at: { type: Sequelize.DATE(3), allowNull: false },
        assigned_by: uuidColumn(Sequelize, { allowNull: true }),
        revoked_at: { type: Sequelize.DATE(3), allowNull: true },
        revoked_by: uuidColumn(Sequelize, { allowNull: true }),
        active: { type: Sequelize.TINYINT(1), allowNull: true },
        version: { type: Sequelize.INTEGER.UNSIGNED, allowNull: false, defaultValue: 1 },
        ...auditTimestamps(Sequelize),
      },
      TABLE_OPTIONS,
    );
    await queryInterface.addIndex('user_roles', ['user_id', 'role_code', 'active'], {
      unique: true,
      name: 'uq_user_roles_active_role',
    });
    await queryInterface.addIndex('user_roles', ['role_code', 'active'], { name: 'ix_user_roles_role_active' });
    await queryInterface.sequelize.query(
      `ALTER TABLE user_roles ADD CONSTRAINT ck_user_roles_role CHECK (role_code IN (
         'MAIN_ADMIN','GOVERNORATE_MANAGER','CENTER_MANAGER','VILLAGE_MANAGER','SCHOOL_MANAGER',
         'TEACHER','PARENT','SUBSCRIPTION_COLLECTOR'))`,
    );
    await queryInterface.sequelize.query(
      `ALTER TABLE user_roles ADD CONSTRAINT ck_user_roles_state CHECK (
         (active = 1 AND revoked_at IS NULL AND revoked_by IS NULL)
         OR (active IS NULL AND revoked_at IS NOT NULL))`,
    );
  },

  async down(queryInterface) {
    await queryInterface.dropTable('user_roles');
  },
};
