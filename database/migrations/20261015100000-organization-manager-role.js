'use strict';

/**
 * Role separation (approved): MAIN_ADMIN is the platform-wide administrator; ORGANIZATION_MANAGER is a separate role limited to
 * ONE organization (the organization link in `organization_admins`, which now means "organization manager link").
 *
 * 1. `ck_user_roles_role` accepts ORGANIZATION_MANAGER (forward-only: the old list stays valid).
 * 2. Every user with an ACTIVE organization link receives an ACTIVE ORGANIZATION_MANAGER role (history row, assigned_by NULL = system),
 *    unless they already hold it. Idempotent. Links are never changed.
 * 3. MAIN_ADMIN is revoked (history kept: revoked_at set, row never deleted) ONLY for users whose MAIN_ADMIN existed solely because
 *    they registered an organization: they have an active link created by the registration flow (`name IS NOT NULL`) and NO link from
 *    the V1 backfill (`name IS NULL`, which is how the first Main Admin and every V1 administrator are linked). Step 2 ran first, so
 *    nobody is ever left without an active role. Nobody is promoted to platform scope; V1 administrators keep MAIN_ADMIN and ALSO get
 *    ORGANIZATION_MANAGER for the organization they already administered (their school access is unchanged).
 * Role events are not written by this SQL migration (no outbox rows); the history rows are the audit record.
 * Forward-only: `down` refuses, because it cannot know which MAIN_ADMIN rows it revoked.
 */
/** The data statements, exported so a database test can run EXACTLY the same SQL against fixture rows (inside a rolled-back transaction). */
const ASSIGN_ORGANIZATION_MANAGER_SQL = `INSERT INTO user_roles (id, user_id, role_code, assigned_at, assigned_by, revoked_at, revoked_by, active, version, created_at, updated_at)
       SELECT UUID(), l.user_id, 'ORGANIZATION_MANAGER', UTC_TIMESTAMP(3), NULL, NULL, NULL, 1, 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)
         FROM (SELECT DISTINCT user_id FROM organization_admins WHERE active = 1) l
        WHERE NOT EXISTS (SELECT 1 FROM user_roles r WHERE r.user_id = l.user_id AND r.role_code = 'ORGANIZATION_MANAGER' AND r.active = 1)`;

const REVOKE_REGISTRATION_MAIN_ADMIN_SQL = `UPDATE user_roles r
          SET r.revoked_at = UTC_TIMESTAMP(3), r.revoked_by = NULL, r.active = NULL, r.updated_at = UTC_TIMESTAMP(3), r.version = r.version + 1
        WHERE r.role_code = 'MAIN_ADMIN' AND r.active = 1
          AND EXISTS (SELECT 1 FROM organization_admins a WHERE a.user_id = r.user_id AND a.active = 1 AND a.name IS NOT NULL)
          AND NOT EXISTS (SELECT 1 FROM organization_admins b WHERE b.user_id = r.user_id AND b.active = 1 AND b.name IS NULL)
          AND EXISTS (SELECT 1 FROM user_roles o WHERE o.user_id = r.user_id AND o.role_code = 'ORGANIZATION_MANAGER' AND o.active = 1)`;

module.exports = {
  ASSIGN_ORGANIZATION_MANAGER_SQL,
  REVOKE_REGISTRATION_MAIN_ADMIN_SQL,

  async up(queryInterface) {
    const sql = (statement) => queryInterface.sequelize.query(statement);

    await sql('ALTER TABLE user_roles DROP CONSTRAINT ck_user_roles_role');
    await sql(
      `ALTER TABLE user_roles ADD CONSTRAINT ck_user_roles_role CHECK (role_code IN (
         'MAIN_ADMIN','ORGANIZATION_MANAGER','GOVERNORATE_MANAGER','CENTER_MANAGER','VILLAGE_MANAGER','SCHOOL_MANAGER',
         'TEACHER','PARENT','SUBSCRIPTION_COLLECTOR'))`,
    );
    await sql(ASSIGN_ORGANIZATION_MANAGER_SQL);
    await sql(REVOKE_REGISTRATION_MAIN_ADMIN_SQL);
  },

  async down() {
    throw new Error('Forward-only migration: organization-manager-role cannot be undone safely (role history would be lost).');
  },
};
