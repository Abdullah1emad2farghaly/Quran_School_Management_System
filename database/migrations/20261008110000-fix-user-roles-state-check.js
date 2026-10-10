'use strict';

/**
 * Fixes ck_user_roles_state from create-user-roles. A CHECK only rejects a row when it evaluates to
 * FALSE, so with `active = 1` the NULL case (active NULL and revoked_at NULL) evaluated to UNKNOWN and was
 * accepted. The null-safe `<=>` makes every inconsistent combination evaluate to FALSE:
 *   active (1)  -> not revoked, no revoker
 *   revoked     -> active IS NULL and revoked_at set
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query('ALTER TABLE user_roles DROP CONSTRAINT ck_user_roles_state');
    await queryInterface.sequelize.query(
      `ALTER TABLE user_roles ADD CONSTRAINT ck_user_roles_state CHECK (
         (active <=> 1 AND revoked_at IS NULL AND revoked_by IS NULL)
         OR (active IS NULL AND revoked_at IS NOT NULL))`,
    );
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query('ALTER TABLE user_roles DROP CONSTRAINT ck_user_roles_state');
    await queryInterface.sequelize.query(
      `ALTER TABLE user_roles ADD CONSTRAINT ck_user_roles_state CHECK (
         (active = 1 AND revoked_at IS NULL AND revoked_by IS NULL)
         OR (active IS NULL AND revoked_at IS NOT NULL))`,
    );
  },
};
