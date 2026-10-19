'use strict';

/**
 * Module 08 (Identity Core) + Module 17 (Parents): the mandatory first-login password change.
 * The requirement belongs to the ACCOUNT, never to a role: `users.must_change_password` is 1 only for an account that was
 * created with an initial password (a new Parent account: last 4 digits of the phone, Master Specification §24) and is
 * cleared by the first successful password change or password reset. Every existing account keeps 0 (no behavior change).
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('users', 'must_change_password', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });
  },

  async down() {
    throw new Error('Forward-only migration: removing the column would silently drop a pending password-change requirement.');
  },
};
