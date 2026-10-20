'use strict';
const { TABLE_OPTIONS, uuidPrimaryKey, uuidColumn, auditTimestamps } = require('../helpers.cjs');

/**
 * Module 18 (Teachers). Two tables, no foreign keys to other modules' tables (Master Specification §14); the key below points only at this
 * module's own `teachers` table.
 * - teachers: one Teacher record per login account (unique user_id) and the organization. The personal name is NOT stored here: it is the
 *   account's canonical name (`users.full_name`, Module 08).
 * - teacher_schools: the Teacher-to-School relationship with history (never deleted). `active` is 1 while current and NULL once removed, so
 *   (teacher_id, school_id, active) allows ONE active link per school and any number of ended ones. The CHECK uses the NULL-safe `<=>` so a row that is
 *   neither active nor removed can never be stored (a plain `=` would evaluate to NULL, which a CHECK accepts).
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable(
      'teachers',
      {
        id: uuidPrimaryKey(Sequelize),
        user_id: uuidColumn(Sequelize),
        organization_id: uuidColumn(Sequelize),
        created_by: uuidColumn(Sequelize),
        version: { type: Sequelize.INTEGER.UNSIGNED, allowNull: false, defaultValue: 1 },
        ...auditTimestamps(Sequelize),
      },
      TABLE_OPTIONS,
    );
    await queryInterface.addIndex('teachers', ['user_id'], { unique: true, name: 'uq_teachers_user' });
    await queryInterface.addIndex('teachers', ['organization_id'], { name: 'ix_teachers_organization' });

    await queryInterface.createTable(
      'teacher_schools',
      {
        id: uuidPrimaryKey(Sequelize),
        teacher_id: uuidColumn(Sequelize, { references: { model: 'teachers', key: 'id' }, onDelete: 'RESTRICT', onUpdate: 'RESTRICT' }),
        school_id: uuidColumn(Sequelize),
        linked_at: { type: Sequelize.DATE(3), allowNull: false },
        linked_by: uuidColumn(Sequelize),
        unlinked_at: { type: Sequelize.DATE(3), allowNull: true },
        unlinked_by: uuidColumn(Sequelize, { allowNull: true }),
        active: { type: Sequelize.TINYINT, allowNull: true },
        version: { type: Sequelize.INTEGER.UNSIGNED, allowNull: false, defaultValue: 1 },
        ...auditTimestamps(Sequelize),
      },
      TABLE_OPTIONS,
    );
    await queryInterface.addIndex('teacher_schools', ['teacher_id', 'school_id', 'active'], { unique: true, name: 'uq_teacher_schools_active' });
    await queryInterface.addIndex('teacher_schools', ['school_id', 'active'], { name: 'ix_teacher_schools_school' });
    await queryInterface.sequelize.query(
      'ALTER TABLE teacher_schools ADD CONSTRAINT ck_teacher_schools_active CHECK ((active <=> 1 AND unlinked_at IS NULL AND unlinked_by IS NULL) OR (active IS NULL AND unlinked_at IS NOT NULL AND unlinked_by IS NOT NULL))',
    );
  },

  async down(queryInterface) {
    await queryInterface.dropTable('teacher_schools');
    await queryInterface.dropTable('teachers');
  },
};
