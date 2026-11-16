'use strict';

/**
 * Module 10 (Sessions & JWT): the ACTIVE ROLE belongs to the AUTH SESSION, never to the user account. One account can be a parent on the phone, a
 * teacher on the laptop and a school manager on the tablet at the same time; switching the role on one device never touches another session.
 *
 * Change: one nullable column, `auth_sessions.active_role` (the role code, same width as `user_roles.role_code`).
 *   NULL  = no role selected yet (a multi-role account right after login), or a session that existed before this migration.
 *
 * Data: NOTHING is rewritten. Every existing session keeps its state and slot; its active_role stays NULL. The backend derives the effective
 * active role of such a session on every request (the stored role when it is still assigned; otherwise the only active role of a single-role
 * account; otherwise none), so existing single-role sessions keep working without a new login and multi-role sessions must pick a role.
 *
 * No CHECK against the role list (the catalog lives in Module 09 and may grow: a stale stored value is harmless because it is validated
 * against the user's CURRENT role assignments on every request) and no new index (the column is only read together with the session row).
 * Forward-only history: earlier migrations are untouched; `down` only drops the column.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('auth_sessions', 'active_role', { type: Sequelize.STRING(32), allowNull: true });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('auth_sessions', 'active_role');
  },
};
