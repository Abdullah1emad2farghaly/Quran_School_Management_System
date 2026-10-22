'use strict';
const { TABLE_OPTIONS, uuidPrimaryKey, uuidColumn, auditTimestamps } = require('../helpers.cjs');

/**
 * Module 20 (Groups). Three tables, no foreign keys to other modules' tables (Master Specification §14); the keys below point only at this
 * module's own `school_groups` table. (`school_groups`, not `groups`: GROUPS is a reserved word in some MySQL versions.)
 * - school_groups: one row per Group of ONE school. `teacher_id`, `school_id`, `organization_id` are plain references to Module 18 / 16 data
 *   (validated by the application in the same transaction). No schedule (Module 23) and no students here. `starting_surah` is the surah NUMBER
 *   (1-114); the surah names belong to Module 21. `active` is 1 while the group is ACTIVE and NULL once ARCHIVED, so the unique index
 *   (school_id, name_key, active) allows ONE ACTIVE group per name in a school and any number of ARCHIVED ones (an archived name is free again).
 *   `name_key` is the lower-cased name compared byte for byte (Arabic letters are never folded).
 * - group_students: the assignment history, one row per period of a student in a group (never deleted). `active` is 1 while current and NULL
 *   once ended, so the unique index (student_id, active) allows ONE current group per student and any number of ended periods.
 *   `unassigned_by` is NULL when the system ended the period (the student was archived).
 * - group_history: append-only history of the group (creation, corrections, Teacher changes, archive). `seq` is the insertion order.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable(
      'school_groups',
      {
        id: uuidPrimaryKey(Sequelize),
        school_id: uuidColumn(Sequelize),
        organization_id: uuidColumn(Sequelize),
        name: { type: Sequelize.STRING(200), allowNull: false },
        name_key: { type: Sequelize.STRING(200).BINARY, allowNull: false },
        teacher_id: uuidColumn(Sequelize, { allowNull: true }),
        learning_mode: { type: Sequelize.STRING(16), allowNull: false },
        progression: { type: Sequelize.STRING(16), allowNull: false },
        starting_surah: { type: Sequelize.SMALLINT.UNSIGNED, allowNull: false },
        status: { type: Sequelize.STRING(16), allowNull: false },
        active: { type: Sequelize.TINYINT, allowNull: true },
        created_by: uuidColumn(Sequelize),
        version: { type: Sequelize.INTEGER.UNSIGNED, allowNull: false, defaultValue: 1 },
        ...auditTimestamps(Sequelize),
      },
      TABLE_OPTIONS,
    );
    await queryInterface.addIndex('school_groups', ['school_id', 'name_key', 'active'], { unique: true, name: 'uq_school_groups_active_name' });
    await queryInterface.addIndex('school_groups', ['school_id', 'status'], { name: 'ix_school_groups_school_status' });
    await queryInterface.addIndex('school_groups', ['teacher_id', 'school_id', 'active'], { name: 'ix_school_groups_teacher' });
    await queryInterface.sequelize.query("ALTER TABLE school_groups ADD CONSTRAINT ck_school_groups_status CHECK ((status = 'ACTIVE' AND active <=> 1) OR (status = 'ARCHIVED' AND active IS NULL))");
    await queryInterface.sequelize.query("ALTER TABLE school_groups ADD CONSTRAINT ck_school_groups_mode CHECK (learning_mode IN ('GROUP', 'INDIVIDUAL'))");
    await queryInterface.sequelize.query("ALTER TABLE school_groups ADD CONSTRAINT ck_school_groups_progression CHECK (progression IN ('FORWARD', 'BACKWARD'))");
    await queryInterface.sequelize.query('ALTER TABLE school_groups ADD CONSTRAINT ck_school_groups_surah CHECK (starting_surah BETWEEN 1 AND 114)');
    await queryInterface.sequelize.query('ALTER TABLE school_groups ADD CONSTRAINT ck_school_groups_name CHECK (CHAR_LENGTH(TRIM(name)) > 0)');

    await queryInterface.createTable(
      'group_students',
      {
        id: uuidPrimaryKey(Sequelize),
        group_id: uuidColumn(Sequelize, { references: { model: 'school_groups', key: 'id' }, onDelete: 'RESTRICT', onUpdate: 'RESTRICT' }),
        student_id: uuidColumn(Sequelize),
        school_id: uuidColumn(Sequelize),
        organization_id: uuidColumn(Sequelize),
        assigned_at: { type: Sequelize.DATE(3), allowNull: false },
        assigned_by: uuidColumn(Sequelize),
        unassigned_at: { type: Sequelize.DATE(3), allowNull: true },
        unassigned_by: uuidColumn(Sequelize, { allowNull: true }),
        end_reason: { type: Sequelize.STRING(20), allowNull: true },
        active: { type: Sequelize.TINYINT, allowNull: true },
      },
      TABLE_OPTIONS,
    );
    await queryInterface.addIndex('group_students', ['student_id', 'active'], { unique: true, name: 'uq_group_students_current' });
    await queryInterface.addIndex('group_students', ['group_id', 'active'], { name: 'ix_group_students_group' });
    await queryInterface.sequelize.query(
      "ALTER TABLE group_students ADD CONSTRAINT ck_group_students_period CHECK ((active <=> 1 AND unassigned_at IS NULL AND end_reason IS NULL AND unassigned_by IS NULL) OR (active IS NULL AND unassigned_at IS NOT NULL AND end_reason IN ('MANUAL', 'MOVED', 'GROUP_ARCHIVED', 'STUDENT_ARCHIVED')))",
    );

    await queryInterface.createTable(
      'group_history',
      {
        id: uuidPrimaryKey(Sequelize),
        group_id: uuidColumn(Sequelize, { references: { model: 'school_groups', key: 'id' }, onDelete: 'RESTRICT', onUpdate: 'RESTRICT' }),
        action: { type: Sequelize.STRING(20), allowNull: false },
        actor_id: uuidColumn(Sequelize),
        occurred_at: { type: Sequelize.DATE(3), allowNull: false },
        reason: { type: Sequelize.STRING(500), allowNull: true },
        previous_name: { type: Sequelize.STRING(200), allowNull: true },
        new_name: { type: Sequelize.STRING(200), allowNull: true },
        previous_teacher_id: uuidColumn(Sequelize, { allowNull: true }),
        new_teacher_id: uuidColumn(Sequelize, { allowNull: true }),
        previous_learning_mode: { type: Sequelize.STRING(16), allowNull: true },
        new_learning_mode: { type: Sequelize.STRING(16), allowNull: true },
        previous_progression: { type: Sequelize.STRING(16), allowNull: true },
        new_progression: { type: Sequelize.STRING(16), allowNull: true },
        previous_starting_surah: { type: Sequelize.SMALLINT.UNSIGNED, allowNull: true },
        new_starting_surah: { type: Sequelize.SMALLINT.UNSIGNED, allowNull: true },
      },
      TABLE_OPTIONS,
    );
    await queryInterface.sequelize.query('ALTER TABLE group_history ADD COLUMN seq BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, ADD UNIQUE KEY uq_group_history_seq (seq)');
    await queryInterface.addIndex('group_history', ['group_id', 'seq'], { name: 'ix_group_history_group' });
    await queryInterface.sequelize.query("ALTER TABLE group_history ADD CONSTRAINT ck_group_history_action CHECK (action IN ('CREATED', 'UPDATED', 'TEACHER_CHANGED', 'ARCHIVED'))");
  },

  async down(queryInterface) {
    await queryInterface.dropTable('group_history');
    await queryInterface.dropTable('group_students');
    await queryInterface.dropTable('school_groups');
  },
};
