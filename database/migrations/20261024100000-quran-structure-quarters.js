'use strict';

/**
 * Module 21: the quarter records (rub' al-hizb, 1..240) of the approved quarter source are imported in V1, so the model gets back the quarter of every
 * ayah and the quarter count of an import. SCHEMA ONLY; additive (earlier migrations untouched); MariaDB 10.4. The tables `quran_quarters` (created by the
 * first Module 21 migration: quarter_number 1..240, hizb_number, juz_number, start, with their CHECKs) now hold the 240 records; `quran_hizb` stays empty
 * and reserved. `quran_quarters.juz_number` is the arithmetic position of the quarter (8 quarters per juz) required by the table's CHECK; it is NOT the
 * juz of the juz table (which follows the official KFGQPC Excel) and is not exposed by the API.
 * Refuses to run if a reshaped table holds data (nothing is dropped or rewritten).
 */
async function assertEmpty(queryInterface) {
  for (const table of ['quran_dataset_imports', 'quran_ayahs', 'quran_quarters']) {
    const [rows] = await queryInterface.sequelize.query(`SELECT COUNT(*) AS n FROM ${table}`);
    if (Number(rows[0].n) > 0) throw new Error(`${table} already holds data: this migration reshapes empty tables only (nothing is dropped or rewritten).`);
  }
}

module.exports = {
  async up(queryInterface) {
    const q = (sql) => queryInterface.sequelize.query(sql);
    await assertEmpty(queryInterface);
    await q('ALTER TABLE quran_ayahs DROP CONSTRAINT ck_quran_ayahs');
    await q('ALTER TABLE quran_ayahs ADD COLUMN quarter_number SMALLINT UNSIGNED NOT NULL AFTER juz_number');
    await q('ALTER TABLE quran_ayahs ADD CONSTRAINT ck_quran_ayahs CHECK (global_ayah BETWEEN 1 AND 6236 AND first_page BETWEEN 1 AND 604 AND last_page BETWEEN first_page AND 604 AND juz_number BETWEEN 1 AND 30 AND quarter_number BETWEEN 1 AND 240 AND has_rub_marker IN (0, 1))');
    await q('ALTER TABLE quran_dataset_imports ADD COLUMN quarter_count SMALLINT UNSIGNED NOT NULL AFTER line_count');
  },

  async down(queryInterface) {
    const q = (sql) => queryInterface.sequelize.query(sql);
    await assertEmpty(queryInterface);
    await q('ALTER TABLE quran_dataset_imports DROP COLUMN quarter_count');
    await q('ALTER TABLE quran_ayahs DROP CONSTRAINT ck_quran_ayahs');
    await q('ALTER TABLE quran_ayahs DROP COLUMN quarter_number');
    await q('ALTER TABLE quran_ayahs ADD CONSTRAINT ck_quran_ayahs CHECK (global_ayah BETWEEN 1 AND 6236 AND first_page BETWEEN 1 AND 604 AND last_page BETWEEN first_page AND 604 AND juz_number BETWEEN 1 AND 30 AND has_rub_marker IN (0, 1))');
  },
};
