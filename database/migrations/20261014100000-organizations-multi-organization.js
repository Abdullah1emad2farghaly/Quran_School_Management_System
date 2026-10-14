'use strict';
const { TABLE_OPTIONS, uuidColumn, uuidPrimaryKey, auditTimestamps } = require('../helpers.cjs');

/**
 * Module 13: organizations become many (approved change: organization creation is its own workflow, independent of schools).
 * - drops the V1 single-organization unique index and CHECK (the `v1_single_guard` column stays, always 1, unused);
 * - organization NAME is unique across the whole system (`uq_organizations_name`, utf8mb4_unicode_ci: case/accent-insensitive);
 * - the organization's own address: `governorate_id` (required by the application), optional `center_id`, `village_id`
 *   (foreign keys RESTRICT; a village needs a center). Nullable in the database so the organization that already exists
 *   (created without an address) keeps working; the application requires them for every new organization. `country_id`
 *   already exists (set once, immutable);
 * - `uq_organizations_id_country (id, country_id)` lets schools reference BOTH columns, so a school's country can never
 *   differ from its organization's country (see migration schools-country-invariant);
 * - `organization_code_sequence`: one locked row that gives ORG-000001, ORG-000002... without duplicates under concurrency
 *   (seeded with the highest code in use);
 * - `organization_admins`: which users administer which organization (the organization scope of the MAIN_ADMIN role), with
 *   history (assigned/revoked). Users are referenced without a foreign key (each module owns its tables).
 * - BACKFILL (explicit, idempotent): V1 had exactly one organization and every active MAIN_ADMIN managed it, so every user that
 *   holds an active MAIN_ADMIN role is linked to every organization that exists right now (one). This keeps today's access
 *   exactly as it is; nothing is granted to anyone who does not already hold MAIN_ADMIN.
 * Never edits an applied migration.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const sql = (statement) => queryInterface.sequelize.query(statement);

    await queryInterface.removeIndex('organizations', 'uq_organizations_v1_single');
    await sql('ALTER TABLE organizations DROP CONSTRAINT ck_organizations_v1_single_guard');

    await queryInterface.addColumn('organizations', 'governorate_id', uuidColumn(Sequelize, { allowNull: true, after: 'country_id' }));
    await queryInterface.addColumn('organizations', 'center_id', uuidColumn(Sequelize, { allowNull: true, after: 'governorate_id' }));
    await queryInterface.addColumn('organizations', 'village_id', uuidColumn(Sequelize, { allowNull: true, after: 'center_id' }));
    for (const [name, column, table] of [
      ['fk_organizations_governorate', 'governorate_id', 'governorates'],
      ['fk_organizations_center', 'center_id', 'centers'],
      ['fk_organizations_village', 'village_id', 'villages'],
    ]) {
      await queryInterface.addConstraint('organizations', {
        fields: [column],
        type: 'foreign key',
        name,
        references: { table, field: 'id' },
        onDelete: 'RESTRICT',
        onUpdate: 'RESTRICT',
      });
    }
    await sql('ALTER TABLE organizations ADD CONSTRAINT ck_organizations_village_needs_center CHECK (village_id IS NULL OR center_id IS NOT NULL)');
    await queryInterface.addIndex('organizations', ['name'], { unique: true, name: 'uq_organizations_name' });
    await queryInterface.addIndex('organizations', ['id', 'country_id'], { unique: true, name: 'uq_organizations_id_country' });

    await queryInterface.createTable(
      'organization_code_sequence',
      {
        name: { type: Sequelize.STRING(32), allowNull: false, primaryKey: true },
        last_value: { type: Sequelize.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
        updated_at: { type: Sequelize.DATE(3), allowNull: false },
      },
      TABLE_OPTIONS,
    );
    await sql(
      "INSERT INTO organization_code_sequence (name, last_value, updated_at) SELECT 'organization', COALESCE(MAX(CAST(SUBSTRING(code, 5) AS UNSIGNED)), 0), UTC_TIMESTAMP(3) FROM organizations",
    );

    await queryInterface.createTable(
      'organization_admins',
      {
        id: uuidPrimaryKey(Sequelize),
        organization_id: uuidColumn(Sequelize),
        user_id: uuidColumn(Sequelize),
        name: { type: Sequelize.STRING(200), allowNull: true },
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
    await queryInterface.addIndex('organization_admins', ['organization_id', 'user_id', 'active'], { unique: true, name: 'uq_organization_admins_active' });
    await queryInterface.addIndex('organization_admins', ['user_id', 'active'], { name: 'ix_organization_admins_user_active' });
    await queryInterface.addConstraint('organization_admins', {
      fields: ['organization_id'],
      type: 'foreign key',
      name: 'fk_organization_admins_organization',
      references: { table: 'organizations', field: 'id' },
      onDelete: 'RESTRICT',
      onUpdate: 'RESTRICT',
    });
    await sql(
      `ALTER TABLE organization_admins ADD CONSTRAINT ck_organization_admins_state CHECK (
         (active = 1 AND revoked_at IS NULL AND revoked_by IS NULL) OR (active IS NULL AND revoked_at IS NOT NULL))`,
    );

    // Explicit, idempotent backfill (see the header comment).
    await sql(
      `INSERT INTO organization_admins (id, organization_id, user_id, name, assigned_at, assigned_by, revoked_at, revoked_by, active, version, created_at, updated_at)
       SELECT UUID(), o.id, ur.user_id, NULL, UTC_TIMESTAMP(3), NULL, NULL, NULL, 1, 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)
         FROM organizations o
         JOIN user_roles ur ON ur.role_code = 'MAIN_ADMIN' AND ur.active = 1
        WHERE NOT EXISTS (SELECT 1 FROM organization_admins a WHERE a.organization_id = o.id AND a.user_id = ur.user_id AND a.active = 1)`,
    );
  },

  async down(queryInterface) {
    const sql = (statement) => queryInterface.sequelize.query(statement);
    await queryInterface.dropTable('organization_admins');
    await queryInterface.dropTable('organization_code_sequence');
    await queryInterface.removeIndex('organizations', 'uq_organizations_id_country');
    await queryInterface.removeIndex('organizations', 'uq_organizations_name');
    await sql('ALTER TABLE organizations DROP CONSTRAINT ck_organizations_village_needs_center');
    for (const name of ['fk_organizations_village', 'fk_organizations_center', 'fk_organizations_governorate']) await queryInterface.removeConstraint('organizations', name);
    for (const column of ['village_id', 'center_id', 'governorate_id']) await queryInterface.removeColumn('organizations', column);
    await sql('ALTER TABLE organizations ADD CONSTRAINT ck_organizations_v1_single_guard CHECK (v1_single_guard = 1)');
    await queryInterface.addIndex('organizations', ['v1_single_guard'], { unique: true, name: 'uq_organizations_v1_single' });
  },
};
