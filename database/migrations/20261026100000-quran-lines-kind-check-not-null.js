'use strict';

/**
 * Module 21: tightens `ck_quran_lines_kind` on `quran_lines`. SCHEMA ONLY; additive (earlier migrations untouched); MariaDB 10.4.
 *
 * Why: a CHECK accepts a row when its expression is TRUE *or UNKNOWN (NULL)*. `surah_number` is nullable (TEXT lines have none), so for a
 * SURAH_HEADER / BASMALA line with `surah_number` NULL the term `surah_number BETWEEN 1 AND 114` was UNKNOWN and the row was accepted. A banner or
 * basmala line without its surah is now rejected by the database (`surah_number IS NOT NULL` is stated explicitly).
 *
 * No data is dropped or rewritten. Re-adding the CHECK validates existing rows; any dataset accepted by the Module 21 validator already satisfies it.
 */
const CHECK_NEW =
  "(kind = 'TEXT' AND surah_number IS NULL AND first_global_ayah IS NOT NULL AND last_global_ayah IS NOT NULL AND first_global_ayah <= last_global_ayah) OR (kind IN ('SURAH_HEADER', 'BASMALA') AND surah_number IS NOT NULL AND surah_number BETWEEN 1 AND 114 AND first_global_ayah IS NULL AND last_global_ayah IS NULL)";
const CHECK_OLD =
  "(kind = 'TEXT' AND surah_number IS NULL AND first_global_ayah IS NOT NULL AND last_global_ayah IS NOT NULL AND first_global_ayah <= last_global_ayah) OR (kind IN ('SURAH_HEADER', 'BASMALA') AND surah_number BETWEEN 1 AND 114 AND first_global_ayah IS NULL AND last_global_ayah IS NULL)";

module.exports = {
  async up(queryInterface) {
    const q = (sql) => queryInterface.sequelize.query(sql);
    await q('ALTER TABLE quran_lines DROP CONSTRAINT ck_quran_lines_kind');
    await q(`ALTER TABLE quran_lines ADD CONSTRAINT ck_quran_lines_kind CHECK (${CHECK_NEW})`);
  },

  async down(queryInterface) {
    const q = (sql) => queryInterface.sequelize.query(sql);
    await q('ALTER TABLE quran_lines DROP CONSTRAINT ck_quran_lines_kind');
    await q(`ALTER TABLE quran_lines ADD CONSTRAINT ck_quran_lines_kind CHECK (${CHECK_OLD})`);
  },
};
