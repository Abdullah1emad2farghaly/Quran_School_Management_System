'use strict';
const { TABLE_OPTIONS, uuidColumn, uuidPrimaryKey, auditTimestamps } = require('../helpers.cjs');

/**
 * Module 10 (Sessions & JWT), Master Specification §25.
 *
 * auth_sessions: one row per login session; rows are never deleted (history is preserved).
 *   active = 1 while the session is current and NULL once revoked. The unique index on (user_id, active)
 *   lets a user have only ONE active session (any number of revoked ones: NULLs are distinct).
 *
 * refresh_tokens: one row per issued refresh token. Only a keyed HASH is stored (token_hash), never the token.
 *   active = 1 for the session's current token, NULL once revoked/rotated, so a session has at most one current
 *   token. Rotated tokens stay (replaced_by_id set) so their reuse can be detected.
 *
 * No foreign keys to other modules' tables (each module owns its tables, §14). The CHECKs use null-safe
 * comparisons: a CHECK only rejects a row when it is FALSE, never when it is UNKNOWN.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable(
      'auth_sessions',
      {
        id: uuidPrimaryKey(Sequelize),
        user_id: uuidColumn(Sequelize),
        revoked_at: { type: Sequelize.DATE(3), allowNull: true },
        revoked_reason: { type: Sequelize.STRING(32), allowNull: true },
        active: { type: Sequelize.TINYINT(1), allowNull: true },
        version: { type: Sequelize.INTEGER.UNSIGNED, allowNull: false, defaultValue: 1 },
        ...auditTimestamps(Sequelize),
      },
      TABLE_OPTIONS,
    );
    await queryInterface.addIndex('auth_sessions', ['user_id', 'active'], { unique: true, name: 'uq_auth_sessions_user_active' });
    await queryInterface.sequelize.query(
      `ALTER TABLE auth_sessions ADD CONSTRAINT ck_auth_sessions_reason CHECK (revoked_reason IS NULL OR revoked_reason IN (
         'LOGIN_REPLACED','LOGOUT','LOGOUT_ALL','USER_DEACTIVATED','PASSWORD_RESET','REFRESH_TOKEN_REUSE'))`,
    );
    await queryInterface.sequelize.query(
      `ALTER TABLE auth_sessions ADD CONSTRAINT ck_auth_sessions_state CHECK (
         (active <=> 1 AND revoked_at IS NULL AND revoked_reason IS NULL)
         OR (active IS NULL AND revoked_at IS NOT NULL AND revoked_reason IS NOT NULL))`,
    );

    await queryInterface.createTable(
      'refresh_tokens',
      {
        id: uuidPrimaryKey(Sequelize),
        session_id: uuidColumn(Sequelize),
        user_id: uuidColumn(Sequelize),
        token_hash: { type: Sequelize.CHAR(64), allowNull: false },
        issued_at: { type: Sequelize.DATE(3), allowNull: false },
        expires_at: { type: Sequelize.DATE(3), allowNull: false },
        revoked_at: { type: Sequelize.DATE(3), allowNull: true },
        replaced_by_id: uuidColumn(Sequelize, { allowNull: true }),
        active: { type: Sequelize.TINYINT(1), allowNull: true },
        version: { type: Sequelize.INTEGER.UNSIGNED, allowNull: false, defaultValue: 1 },
        ...auditTimestamps(Sequelize),
      },
      TABLE_OPTIONS,
    );
    await queryInterface.addIndex('refresh_tokens', ['token_hash'], { unique: true, name: 'uq_refresh_tokens_hash' });
    await queryInterface.addIndex('refresh_tokens', ['session_id', 'active'], { unique: true, name: 'uq_refresh_tokens_session_active' });
    await queryInterface.addIndex('refresh_tokens', ['user_id'], { name: 'ix_refresh_tokens_user' });
    await queryInterface.sequelize.query(
      `ALTER TABLE refresh_tokens ADD CONSTRAINT ck_refresh_tokens_state CHECK (
         (active <=> 1 AND revoked_at IS NULL AND replaced_by_id IS NULL)
         OR (active IS NULL AND revoked_at IS NOT NULL))`,
    );
    await queryInterface.sequelize.query(
      'ALTER TABLE refresh_tokens ADD CONSTRAINT ck_refresh_tokens_expiry CHECK (expires_at > issued_at)',
    );
  },

  async down(queryInterface) {
    await queryInterface.dropTable('refresh_tokens');
    await queryInterface.dropTable('auth_sessions');
  },
};
