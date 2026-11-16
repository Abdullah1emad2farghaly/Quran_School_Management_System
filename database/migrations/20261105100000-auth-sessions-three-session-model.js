'use strict';

/**
 * Module 10 (Sessions & JWT), Master Specification §25, approved AMENDMENT: up to THREE concurrent active sessions per account (every role),
 * replacing "only one active session per user". The earlier migration (20261009100000) is left untouched: migration history is never rewritten.
 *
 * Design: each ACTIVE session occupies one slot (1..3); a revoked session has slot NULL, which frees the slot (NULLs never collide, so any number of
 * revoked sessions is kept as history). The database itself enforces the limit:
 *   - CHECK slot IS NULL OR slot BETWEEN 1 AND 3            (never more than three slots exist)
 *   - UNIQUE (user_id, slot)                                (two racing logins can never take the same slot)
 *   - CHECK state: active <=> slot IS NOT NULL              (a session holds a slot exactly while it is active)
 *
 * Data: every existing active session (at most one per user under the old rule) receives slot 1. No row is deleted or rewritten otherwise.
 * New columns: slot, device_label (a coarse "Browser on System" for "My devices"; NULL for sessions created before this migration).
 * New revoke reasons: SESSION_EXPIRED, DEVICE_REVOKED, PASSWORD_CHANGED (LOGIN_REPLACED stays valid for historical rows).
 *
 * Order: everything new is added BEFORE the old unique index (user_id, active) is dropped, so the table is never without a guard. A plain index on
 * (user_id, active) replaces it for the "lock the user's active sessions" query.
 */
const NEW_REASONS = ['SESSION_EXPIRED', 'DEVICE_REVOKED', 'PASSWORD_CHANGED'];
const OLD_REASONS = ['LOGIN_REPLACED', 'LOGOUT', 'LOGOUT_ALL', 'USER_DEACTIVATED', 'PASSWORD_RESET', 'REFRESH_TOKEN_REUSE'];
const list = (values) => values.map((v) => `'${v}'`).join(',');

module.exports = {
  async up(queryInterface, Sequelize) {
    const q = (sql) => queryInterface.sequelize.query(sql);

    await queryInterface.addColumn('auth_sessions', 'slot', { type: Sequelize.TINYINT.UNSIGNED, allowNull: true });
    await queryInterface.addColumn('auth_sessions', 'device_label', { type: Sequelize.STRING(100), allowNull: true });

    // Existing data: at most one active session per user (the old unique index guaranteed it) -> slot 1.
    await q('UPDATE auth_sessions SET slot = 1 WHERE active = 1');

    await q('ALTER TABLE auth_sessions DROP CONSTRAINT ck_auth_sessions_reason');
    await q(
      `ALTER TABLE auth_sessions ADD CONSTRAINT ck_auth_sessions_reason CHECK (revoked_reason IS NULL OR revoked_reason IN (${list([...OLD_REASONS, ...NEW_REASONS])}))`,
    );
    await q('ALTER TABLE auth_sessions DROP CONSTRAINT ck_auth_sessions_state');
    await q(
      `ALTER TABLE auth_sessions ADD CONSTRAINT ck_auth_sessions_state CHECK (
         (active <=> 1 AND slot IS NOT NULL AND revoked_at IS NULL AND revoked_reason IS NULL)
         OR (active IS NULL AND slot IS NULL AND revoked_at IS NOT NULL AND revoked_reason IS NOT NULL))`,
    );
    await q('ALTER TABLE auth_sessions ADD CONSTRAINT ck_auth_sessions_slot CHECK (slot IS NULL OR slot BETWEEN 1 AND 3)');

    await queryInterface.addIndex('auth_sessions', ['user_id', 'slot'], { unique: true, name: 'uq_auth_sessions_user_slot' });
    await queryInterface.addIndex('auth_sessions', ['user_id', 'active'], { name: 'ix_auth_sessions_user_active' });
    await queryInterface.removeIndex('auth_sessions', 'uq_auth_sessions_user_active');
  },

  /**
   * Reverting to the one-session model is only possible without losing history. It REFUSES (and changes nothing) when any user has more than one
   * active session, or when a session was revoked for one of the new reasons (they would violate the old CHECK): resolve those rows manually first.
   */
  async down(queryInterface) {
    const q = (sql) => queryInterface.sequelize.query(sql);
    const [multi] = await q('SELECT user_id FROM auth_sessions WHERE active = 1 GROUP BY user_id HAVING COUNT(*) > 1 LIMIT 1');
    if (multi.length > 0) {
      throw new Error('Cannot revert: a user has more than one active session. Revoke the extra sessions first (nothing was changed).');
    }
    const [reasons] = await q(`SELECT id FROM auth_sessions WHERE revoked_reason IN (${list(NEW_REASONS)}) LIMIT 1`);
    if (reasons.length > 0) {
      throw new Error('Cannot revert: sessions exist that were revoked for SESSION_EXPIRED, DEVICE_REVOKED or PASSWORD_CHANGED. Resolve them manually first (nothing was changed).');
    }

    await queryInterface.addIndex('auth_sessions', ['user_id', 'active'], { unique: true, name: 'uq_auth_sessions_user_active' });
    await queryInterface.removeIndex('auth_sessions', 'ix_auth_sessions_user_active');
    await queryInterface.removeIndex('auth_sessions', 'uq_auth_sessions_user_slot');
    await q('ALTER TABLE auth_sessions DROP CONSTRAINT ck_auth_sessions_slot');
    await q('ALTER TABLE auth_sessions DROP CONSTRAINT ck_auth_sessions_state');
    await q(
      `ALTER TABLE auth_sessions ADD CONSTRAINT ck_auth_sessions_state CHECK (
         (active <=> 1 AND revoked_at IS NULL AND revoked_reason IS NULL)
         OR (active IS NULL AND revoked_at IS NOT NULL AND revoked_reason IS NOT NULL))`,
    );
    await q('ALTER TABLE auth_sessions DROP CONSTRAINT ck_auth_sessions_reason');
    await q(`ALTER TABLE auth_sessions ADD CONSTRAINT ck_auth_sessions_reason CHECK (revoked_reason IS NULL OR revoked_reason IN (${list(OLD_REASONS)}))`);
    await queryInterface.removeColumn('auth_sessions', 'device_label');
    await queryInterface.removeColumn('auth_sessions', 'slot');
  },
};
