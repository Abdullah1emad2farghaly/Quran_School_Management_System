'use strict';
const { TABLE_OPTIONS } = require('../helpers.cjs');

/**
 * Module 21: reshapes the V1 Quran structure to what the approved source package (KFGQPC Hafs v30) evidences. SCHEMA ONLY; additive migration (the
 * previous Module 21 migration is untouched). Target: MariaDB 10.4 (also valid on MySQL 8.0.19+).
 *  - quran_ayahs: the official text is REQUIRED; `quarter_number` (a 1..240 numbering the package cannot evidence) is replaced by `juz_number` (the
 *    official `jozz` field) and `has_rub_marker` (a printed quarter marker starts at the ayah).
 *  - quran_juz: `verification` records how each juz start relates to the printed quarter markers of the same package.
 *  - quran_quarter_marks (new): the printed quarter markers; `mark_number` is an ordinal among the markers, NOT a quarter number.
 *  - quran_dataset_imports: `quarter_mark_count`, `source_files_json` (the source files with their SHA-256); `has_text` and `quarter_count` removed.
 *  - quran_hizb and quran_quarters are kept EMPTY and RESERVED for exact hizb/quarter boundaries of a future version (V1 does not read or write them).
 * Nothing is dropped that holds data: the migration refuses to run if any reshaped table is populated.
 */
async function assertEmpty(queryInterface) {
  for (const table of ['quran_dataset_imports', 'quran_ayahs', 'quran_juz']) {
    const [rows] = await queryInterface.sequelize.query(`SELECT COUNT(*) AS n FROM ${table}`);
    if (Number(rows[0].n) > 0) throw new Error(`${table} already holds data: this migration reshapes empty tables only (nothing is dropped or rewritten).`);
  }
}

module.exports = {
  async up(queryInterface, Sequelize) {
    const q = (sql) => queryInterface.sequelize.query(sql);
    await assertEmpty(queryInterface);

    await q('ALTER TABLE quran_ayahs DROP CONSTRAINT ck_quran_ayahs');
    await q('ALTER TABLE quran_ayahs DROP COLUMN quarter_number');
    await q('ALTER TABLE quran_ayahs ADD COLUMN juz_number SMALLINT UNSIGNED NOT NULL AFTER last_line, ADD COLUMN has_rub_marker TINYINT NOT NULL AFTER juz_number');
    await q('ALTER TABLE quran_ayahs MODIFY ayah_text TEXT NOT NULL');
    await q('ALTER TABLE quran_ayahs ADD CONSTRAINT ck_quran_ayahs CHECK (global_ayah BETWEEN 1 AND 6236 AND first_page BETWEEN 1 AND 604 AND last_page BETWEEN first_page AND 604 AND juz_number BETWEEN 1 AND 30 AND has_rub_marker IN (0, 1))');

    await q('ALTER TABLE quran_juz ADD COLUMN verification VARCHAR(24) NOT NULL AFTER juz_number');
    await q("ALTER TABLE quran_juz ADD CONSTRAINT ck_quran_juz_verification CHECK (verification IN ('MARKER_CONFIRMED', 'SURAH_START_NO_MARKER', 'MARKER_CONFLICT'))");

    const small = () => ({ type: Sequelize.SMALLINT.UNSIGNED, allowNull: false });
    await queryInterface.createTable(
      'quran_quarter_marks',
      { mark_number: { ...small(), primaryKey: true }, start_global_ayah: small(), start_surah_number: small(), start_ayah_number: small() },
      TABLE_OPTIONS,
    );
    await queryInterface.addIndex('quran_quarter_marks', ['start_global_ayah'], { unique: true, name: 'uq_quran_quarter_marks_start' });
    await q('ALTER TABLE quran_quarter_marks ADD CONSTRAINT ck_quran_quarter_marks CHECK (mark_number BETWEEN 1 AND 240 AND start_global_ayah BETWEEN 1 AND 6236 AND start_surah_number BETWEEN 1 AND 114)');

    await q('ALTER TABLE quran_dataset_imports DROP COLUMN has_text, DROP COLUMN quarter_count, ADD COLUMN quarter_mark_count SMALLINT UNSIGNED NOT NULL AFTER line_count, ADD COLUMN source_files_json TEXT NULL AFTER source_retrieved_on');
  },

  async down(queryInterface) {
    const q = (sql) => queryInterface.sequelize.query(sql);
    await assertEmpty(queryInterface);
    await q('ALTER TABLE quran_dataset_imports DROP COLUMN source_files_json, DROP COLUMN quarter_mark_count, ADD COLUMN has_text TINYINT NOT NULL AFTER checksum, ADD COLUMN quarter_count SMALLINT UNSIGNED NOT NULL AFTER line_count');
    await queryInterface.dropTable('quran_quarter_marks');
    await q('ALTER TABLE quran_juz DROP CONSTRAINT ck_quran_juz_verification');
    await q('ALTER TABLE quran_juz DROP COLUMN verification');
    await q('ALTER TABLE quran_ayahs DROP CONSTRAINT ck_quran_ayahs');
    await q('ALTER TABLE quran_ayahs DROP COLUMN has_rub_marker, DROP COLUMN juz_number');
    await q('ALTER TABLE quran_ayahs ADD COLUMN quarter_number SMALLINT UNSIGNED NOT NULL AFTER last_line');
    await q('ALTER TABLE quran_ayahs MODIFY ayah_text TEXT NULL');
    await q('ALTER TABLE quran_ayahs ADD CONSTRAINT ck_quran_ayahs CHECK (global_ayah BETWEEN 1 AND 6236 AND first_page BETWEEN 1 AND 604 AND last_page BETWEEN first_page AND 604 AND quarter_number BETWEEN 1 AND 240)');
  },
};
