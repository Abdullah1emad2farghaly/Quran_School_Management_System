'use strict';
const { TABLE_OPTIONS, uuidPrimaryKey, uuidColumn } = require('../helpers.cjs');

/**
 * Module 29 (Evaluations, Master Specification §52 as amended by the approved Module 29 decisions). Two tables; no foreign keys to other modules' tables (§14).
 * - evaluations: ONE student's evaluation for ONE class session. UNIQUE (session_id, student_id). It holds the ONE optional Teacher note (at most 200 characters, shared by all
 *   categories, written once with the row and never updated by the application). `session_id`, `school_id`, `group_id`, `student_id` are plain references to Module 24 / 16 /
 *   20 / 19 data (validated by the application); `occurrence_date` and `scheduled_start` are a snapshot of the session so a student's evaluations list by date without reading
 *   sessions. Rows are NEVER deleted.
 * - evaluation_scores: one row per (evaluation, category): the score 0.00-10.00 (two decimals) and the Memorization / Revision assignment it is associated with (plain
 *   references to Module 27 / 28). The Memorization score always has a memorization assignment, the Revision score always a revision assignment, Performance and Tajweed at least one.
 *   A score change UPDATES the row: NO history table exists (approved: previous values are not retained).
 * `note` and the assignment ids are nullable, so every CHECK that involves them is written so that it cannot pass on a NULL by accident.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable(
      'evaluations',
      {
        id: uuidPrimaryKey(Sequelize),
        session_id: uuidColumn(Sequelize),
        school_id: uuidColumn(Sequelize),
        group_id: uuidColumn(Sequelize),
        student_id: uuidColumn(Sequelize),
        occurrence_date: { type: Sequelize.DATEONLY, allowNull: false },
        scheduled_start: { type: Sequelize.DATE(3), allowNull: false },
        note: { type: Sequelize.STRING(200), allowNull: true },
        recorded_by: uuidColumn(Sequelize),
        recorded_at: { type: Sequelize.DATE(3), allowNull: false },
        updated_by: uuidColumn(Sequelize),
        updated_at: { type: Sequelize.DATE(3), allowNull: false },
      },
      TABLE_OPTIONS,
    );
    await queryInterface.addIndex('evaluations', ['session_id', 'student_id'], { unique: true, name: 'uq_evaluations_session_student' });
    await queryInterface.addIndex('evaluations', ['student_id', 'scheduled_start'], { name: 'ix_evaluations_student' });
    // A saved note is never empty: NULL means "no note". (NULL passes a CHECK, which is exactly the intent for this one optional column.)
    await queryInterface.sequelize.query('ALTER TABLE evaluations ADD CONSTRAINT ck_evaluations_note CHECK (note IS NULL OR (CHAR_LENGTH(note) BETWEEN 1 AND 200 AND CHAR_LENGTH(TRIM(note)) > 0))');

    await queryInterface.createTable(
      'evaluation_scores',
      {
        evaluation_id: uuidColumn(Sequelize),
        category: { type: Sequelize.STRING(16), allowNull: false },
        score: { type: Sequelize.DECIMAL(4, 2), allowNull: false },
        memorization_assignment_id: { type: Sequelize.CHAR(36), allowNull: true },
        revision_assignment_id: { type: Sequelize.CHAR(36), allowNull: true },
      },
      TABLE_OPTIONS,
    );
    await queryInterface.sequelize.query('ALTER TABLE evaluation_scores ADD PRIMARY KEY (evaluation_id, category)');
    await queryInterface.sequelize.query('ALTER TABLE evaluation_scores ADD CONSTRAINT fk_evaluation_scores_evaluation FOREIGN KEY (evaluation_id) REFERENCES evaluations (id) ON DELETE RESTRICT ON UPDATE RESTRICT');
    await queryInterface.sequelize.query("ALTER TABLE evaluation_scores ADD CONSTRAINT ck_evaluation_scores_category CHECK (category IN ('MEMORIZATION', 'REVISION', 'PERFORMANCE', 'TAJWEED'))");
    await queryInterface.sequelize.query('ALTER TABLE evaluation_scores ADD CONSTRAINT ck_evaluation_scores_range CHECK (score >= 0 AND score <= 10)');
    // The assignment association, NULL-safe: each branch is a definite TRUE/FALSE ("IS NOT NULL"), never NULL.
    await queryInterface.sequelize.query(
      "ALTER TABLE evaluation_scores ADD CONSTRAINT ck_evaluation_scores_assignment CHECK (" +
        "(category = 'MEMORIZATION' AND memorization_assignment_id IS NOT NULL AND revision_assignment_id IS NULL) OR " +
        "(category = 'REVISION' AND revision_assignment_id IS NOT NULL AND memorization_assignment_id IS NULL) OR " +
        "(category IN ('PERFORMANCE', 'TAJWEED') AND (memorization_assignment_id IS NOT NULL OR revision_assignment_id IS NOT NULL)))",
    );
  },

  async down(queryInterface) {
    await queryInterface.dropTable('evaluation_scores');
    await queryInterface.dropTable('evaluations');
  },
};
