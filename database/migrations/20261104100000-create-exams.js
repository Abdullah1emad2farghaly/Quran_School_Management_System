'use strict';
const { TABLE_OPTIONS, uuidPrimaryKey, uuidColumn } = require('../helpers.cjs');

/**
 * Module 30 (Exams, Master Specification §53-57 as amended by the approved Module 30 decisions). Additive. No foreign keys to other modules' tables (§14); the only foreign keys
 * are to this module's own parent table `exams`. `school_id`, `group_id`, `student_id` and `teacher_id` are plain references validated by the application.
 * - exams: the exam. Status DRAFT, SCHEDULED, STARTED, COMPLETED, ENDED or CANCELLED. ONE uniform `max_score` for every question. `end_at` is optional (NULL: the School Manager
 *   completes the exam). `deleted_at` is a soft delete (deletion is only possible before STARTED); deleted exams are kept and never shown.
 * - exam_groups: the targeted groups (none for a whole-school exam).
 * - exam_examiners: the examiners. `released_at` NULL means currently assigned (the exam-scoped permission); a removal or the exam ENDING sets it. Rows are kept.
 * - exam_students: the FROZEN target list, created when the exam STARTS. Only `status` changes (PENDING -> EXAMINED, or -> ABSENT when the exam COMPLETES).
 * - exam_results / exam_result_scores: one immutable result per (exam, student) with one score per question. The application never updates or deletes them (no code path exists).
 * Every CHECK is written so that a NULL cannot pass by accident ("end_at IS NULL OR ..." is the only intended NULL).
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable(
      'exams',
      {
        id: uuidPrimaryKey(Sequelize),
        school_id: uuidColumn(Sequelize),
        whole_school: { type: Sequelize.BOOLEAN, allowNull: false },
        status: { type: Sequelize.STRING(16), allowNull: false },
        start_at: { type: Sequelize.DATE(3), allowNull: false },
        end_at: { type: Sequelize.DATE(3), allowNull: true },
        question_count: { type: Sequelize.INTEGER, allowNull: false },
        max_score: { type: Sequelize.DECIMAL(6, 2), allowNull: false },
        created_by: uuidColumn(Sequelize),
        created_at: { type: Sequelize.DATE(3), allowNull: false },
        updated_at: { type: Sequelize.DATE(3), allowNull: false },
        scheduled_at: { type: Sequelize.DATE(3), allowNull: true },
        started_at: { type: Sequelize.DATE(3), allowNull: true },
        completed_at: { type: Sequelize.DATE(3), allowNull: true },
        ended_at: { type: Sequelize.DATE(3), allowNull: true },
        cancelled_at: { type: Sequelize.DATE(3), allowNull: true },
        deleted_at: { type: Sequelize.DATE(3), allowNull: true },
      },
      TABLE_OPTIONS,
    );
    await queryInterface.addIndex('exams', ['school_id', 'start_at'], { name: 'ix_exams_school' });
    await queryInterface.addIndex('exams', ['status', 'start_at'], { name: 'ix_exams_due_start' });
    await queryInterface.addIndex('exams', ['status', 'end_at'], { name: 'ix_exams_due_end' });
    const q = (sql) => queryInterface.sequelize.query(sql);
    await q("ALTER TABLE exams ADD CONSTRAINT ck_exams_status CHECK (status IN ('DRAFT', 'SCHEDULED', 'STARTED', 'COMPLETED', 'ENDED', 'CANCELLED'))");
    await q('ALTER TABLE exams ADD CONSTRAINT ck_exams_questions CHECK (question_count >= 1 AND question_count <= 200)');
    await q('ALTER TABLE exams ADD CONSTRAINT ck_exams_max_score CHECK (max_score > 0 AND max_score <= 1000)');
    await q('ALTER TABLE exams ADD CONSTRAINT ck_exams_end_after_start CHECK (end_at IS NULL OR end_at > start_at)');
    await q("ALTER TABLE exams ADD CONSTRAINT ck_exams_whole_school CHECK (whole_school IN (0, 1))");

    await queryInterface.createTable('exam_groups', { exam_id: uuidColumn(Sequelize), group_id: uuidColumn(Sequelize) }, TABLE_OPTIONS);
    await q('ALTER TABLE exam_groups ADD PRIMARY KEY (exam_id, group_id)');
    await q('ALTER TABLE exam_groups ADD CONSTRAINT fk_exam_groups_exam FOREIGN KEY (exam_id) REFERENCES exams (id) ON DELETE RESTRICT ON UPDATE RESTRICT');
    await queryInterface.addIndex('exam_groups', ['group_id'], { name: 'ix_exam_groups_group' });

    await queryInterface.createTable(
      'exam_examiners',
      {
        exam_id: uuidColumn(Sequelize),
        teacher_id: uuidColumn(Sequelize),
        assigned_at: { type: Sequelize.DATE(3), allowNull: false },
        assigned_by: uuidColumn(Sequelize),
        released_at: { type: Sequelize.DATE(3), allowNull: true },
        release_reason: { type: Sequelize.STRING(16), allowNull: true },
      },
      TABLE_OPTIONS,
    );
    await q('ALTER TABLE exam_examiners ADD PRIMARY KEY (exam_id, teacher_id)');
    await q('ALTER TABLE exam_examiners ADD CONSTRAINT fk_exam_examiners_exam FOREIGN KEY (exam_id) REFERENCES exams (id) ON DELETE RESTRICT ON UPDATE RESTRICT');
    await q("ALTER TABLE exam_examiners ADD CONSTRAINT ck_exam_examiners_release CHECK ((released_at IS NULL AND release_reason IS NULL) OR (released_at IS NOT NULL AND release_reason IS NOT NULL AND release_reason IN ('REMOVED', 'EXAM_ENDED')))");
    await queryInterface.addIndex('exam_examiners', ['teacher_id', 'released_at'], { name: 'ix_exam_examiners_teacher' });

    await queryInterface.createTable(
      'exam_students',
      {
        exam_id: uuidColumn(Sequelize),
        student_id: uuidColumn(Sequelize),
        group_id: uuidColumn(Sequelize),
        group_name: { type: Sequelize.STRING(200), allowNull: false },
        full_name: { type: Sequelize.STRING(300), allowNull: false },
        status: { type: Sequelize.STRING(16), allowNull: false },
      },
      TABLE_OPTIONS,
    );
    await q('ALTER TABLE exam_students ADD PRIMARY KEY (exam_id, student_id)');
    await q('ALTER TABLE exam_students ADD CONSTRAINT fk_exam_students_exam FOREIGN KEY (exam_id) REFERENCES exams (id) ON DELETE RESTRICT ON UPDATE RESTRICT');
    await q("ALTER TABLE exam_students ADD CONSTRAINT ck_exam_students_status CHECK (status IN ('PENDING', 'EXAMINED', 'ABSENT'))");
    await queryInterface.addIndex('exam_students', ['exam_id', 'group_id', 'status'], { name: 'ix_exam_students_group' });
    await queryInterface.addIndex('exam_students', ['student_id'], { name: 'ix_exam_students_student' });

    await queryInterface.createTable(
      'exam_results',
      {
        id: uuidPrimaryKey(Sequelize),
        exam_id: uuidColumn(Sequelize),
        school_id: uuidColumn(Sequelize),
        group_id: uuidColumn(Sequelize),
        student_id: uuidColumn(Sequelize),
        total_score: { type: Sequelize.DECIMAL(10, 2), allowNull: false },
        examiner_teacher_id: uuidColumn(Sequelize),
        examiner_user_id: uuidColumn(Sequelize),
        recorded_at: { type: Sequelize.DATE(3), allowNull: false },
      },
      TABLE_OPTIONS,
    );
    await queryInterface.addIndex('exam_results', ['exam_id', 'student_id'], { unique: true, name: 'uq_exam_results_exam_student' });
    await queryInterface.addIndex('exam_results', ['student_id'], { name: 'ix_exam_results_student' });
    await q('ALTER TABLE exam_results ADD CONSTRAINT fk_exam_results_exam FOREIGN KEY (exam_id) REFERENCES exams (id) ON DELETE RESTRICT ON UPDATE RESTRICT');
    await q('ALTER TABLE exam_results ADD CONSTRAINT ck_exam_results_total CHECK (total_score >= 0)');

    await queryInterface.createTable(
      'exam_result_scores',
      { result_id: uuidColumn(Sequelize), question_number: { type: Sequelize.INTEGER, allowNull: false }, score: { type: Sequelize.DECIMAL(6, 2), allowNull: false } },
      TABLE_OPTIONS,
    );
    await q('ALTER TABLE exam_result_scores ADD PRIMARY KEY (result_id, question_number)');
    await q('ALTER TABLE exam_result_scores ADD CONSTRAINT fk_exam_result_scores_result FOREIGN KEY (result_id) REFERENCES exam_results (id) ON DELETE RESTRICT ON UPDATE RESTRICT');
    await q('ALTER TABLE exam_result_scores ADD CONSTRAINT ck_exam_result_scores_range CHECK (score >= 0 AND score <= 1000 AND question_number >= 1)');
  },

  async down(queryInterface) {
    for (const table of ['exam_result_scores', 'exam_results', 'exam_students', 'exam_examiners', 'exam_groups', 'exams']) await queryInterface.dropTable(table);
  },
};
