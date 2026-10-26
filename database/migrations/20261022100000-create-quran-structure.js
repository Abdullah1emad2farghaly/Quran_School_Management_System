'use strict';
const { TABLE_OPTIONS } = require('../helpers.cjs');

/**
 * Module 21 (Quran Structure): immutable reference data of the approved edition (Madinah Mushaf, Hafs from Asim, 604 pages). SCHEMA ONLY: the data
 * is loaded by `npm run import:quran` (never by a migration). No foreign key leaves this module's tables (Master Specification §14); the keys below
 * connect only tables of this module. Other modules reference positions by NUMBER (surah, ayah, global position), never by a key.
 * - quran_dataset_imports: attribution and checksum of every import. `active` is 1 for the current one and NULL once SUPERSEDED, so the unique index
 *   allows exactly ONE active import.
 * - quran_surahs / quran_ayahs / quran_pages / quran_lines / quran_quarters / quran_hizb / quran_juz: the structure. `global_ayah` (1..6236) is the
 *   canonical global position; `global_line` is the global line number in page/line order.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const q = (sql) => queryInterface.sequelize.query(sql);
    const small = () => ({ type: Sequelize.SMALLINT.UNSIGNED, allowNull: false });

    await queryInterface.createTable(
      'quran_dataset_imports',
      {
        id: { type: Sequelize.CHAR(36), allowNull: false, primaryKey: true },
        edition_code: { type: Sequelize.STRING(64), allowNull: false },
        source_provider: { type: Sequelize.STRING(200), allowNull: false },
        source_name: { type: Sequelize.STRING(200), allowNull: false },
        source_version: { type: Sequelize.STRING(100), allowNull: true },
        source_url: { type: Sequelize.STRING(500), allowNull: true },
        source_license: { type: Sequelize.STRING(500), allowNull: true },
        source_retrieved_on: { type: Sequelize.STRING(10), allowNull: true },
        checksum: { type: Sequelize.CHAR(64), allowNull: false },
        has_text: { type: Sequelize.TINYINT, allowNull: false },
        surah_count: small(),
        ayah_count: small(),
        page_count: small(),
        line_count: { type: Sequelize.INTEGER.UNSIGNED, allowNull: false },
        quarter_count: small(),
        status: { type: Sequelize.STRING(16), allowNull: false },
        active: { type: Sequelize.TINYINT, allowNull: true },
        imported_at: { type: Sequelize.DATE(3), allowNull: false },
        superseded_at: { type: Sequelize.DATE(3), allowNull: true },
      },
      TABLE_OPTIONS,
    );
    await queryInterface.addIndex('quran_dataset_imports', ['active'], { unique: true, name: 'uq_quran_dataset_imports_active' });
    await queryInterface.addIndex('quran_dataset_imports', ['checksum'], { name: 'ix_quran_dataset_imports_checksum' });
    await q("ALTER TABLE quran_dataset_imports ADD CONSTRAINT ck_quran_dataset_imports_status CHECK ((status = 'ACTIVE' AND active <=> 1) OR (status = 'SUPERSEDED' AND active IS NULL))");

    await queryInterface.createTable(
      'quran_surahs',
      {
        surah_number: { ...small(), primaryKey: true },
        name_ar: { type: Sequelize.STRING(100), allowNull: false },
        ayah_count: small(),
        first_global_ayah: small(),
      },
      TABLE_OPTIONS,
    );
    await queryInterface.addIndex('quran_surahs', ['first_global_ayah'], { unique: true, name: 'uq_quran_surahs_first_global_ayah' });
    await q('ALTER TABLE quran_surahs ADD CONSTRAINT ck_quran_surahs_number CHECK (surah_number BETWEEN 1 AND 114 AND ayah_count > 0)');

    await queryInterface.createTable(
      'quran_pages',
      { page_number: { ...small(), primaryKey: true }, line_count: { type: Sequelize.TINYINT.UNSIGNED, allowNull: false }, first_global_ayah: small(), last_global_ayah: small() },
      TABLE_OPTIONS,
    );
    await q('ALTER TABLE quran_pages ADD CONSTRAINT ck_quran_pages CHECK (page_number BETWEEN 1 AND 604 AND line_count > 0 AND first_global_ayah <= last_global_ayah)');

    await queryInterface.createTable(
      'quran_ayahs',
      {
        global_ayah: { ...small(), primaryKey: true },
        surah_number: small(),
        ayah_number: small(),
        ayah_text: { type: Sequelize.TEXT, allowNull: true },
        first_page: small(),
        first_line: small(),
        last_page: small(),
        last_line: small(),
        quarter_number: small(),
      },
      TABLE_OPTIONS,
    );
    await queryInterface.addIndex('quran_ayahs', ['surah_number', 'ayah_number'], { unique: true, name: 'uq_quran_ayahs_surah_ayah' });
    await queryInterface.addConstraint('quran_ayahs', { fields: ['surah_number'], type: 'foreign key', name: 'fk_quran_ayahs_surah', references: { table: 'quran_surahs', field: 'surah_number' }, onDelete: 'RESTRICT', onUpdate: 'RESTRICT' });
    await q('ALTER TABLE quran_ayahs ADD CONSTRAINT ck_quran_ayahs CHECK (global_ayah BETWEEN 1 AND 6236 AND first_page BETWEEN 1 AND 604 AND last_page BETWEEN first_page AND 604 AND quarter_number BETWEEN 1 AND 240)');

    await queryInterface.createTable(
      'quran_lines',
      {
        global_line: { type: Sequelize.INTEGER.UNSIGNED, allowNull: false, primaryKey: true },
        page_number: small(),
        line_number: { type: Sequelize.TINYINT.UNSIGNED, allowNull: false },
        kind: { type: Sequelize.STRING(16), allowNull: false },
        surah_number: { type: Sequelize.SMALLINT.UNSIGNED, allowNull: true },
        first_global_ayah: { type: Sequelize.SMALLINT.UNSIGNED, allowNull: true },
        last_global_ayah: { type: Sequelize.SMALLINT.UNSIGNED, allowNull: true },
      },
      TABLE_OPTIONS,
    );
    await queryInterface.addIndex('quran_lines', ['page_number', 'line_number'], { unique: true, name: 'uq_quran_lines_page_line' });
    await queryInterface.addIndex('quran_lines', ['first_global_ayah'], { name: 'ix_quran_lines_first_ayah' });
    await queryInterface.addConstraint('quran_lines', { fields: ['page_number'], type: 'foreign key', name: 'fk_quran_lines_page', references: { table: 'quran_pages', field: 'page_number' }, onDelete: 'RESTRICT', onUpdate: 'RESTRICT' });
    await q(
      "ALTER TABLE quran_lines ADD CONSTRAINT ck_quran_lines_kind CHECK ((kind = 'TEXT' AND surah_number IS NULL AND first_global_ayah IS NOT NULL AND last_global_ayah IS NOT NULL AND first_global_ayah <= last_global_ayah) OR (kind IN ('SURAH_HEADER', 'BASMALA') AND surah_number BETWEEN 1 AND 114 AND first_global_ayah IS NULL AND last_global_ayah IS NULL))",
    );

    const division = { start_global_ayah: small(), start_surah_number: small(), start_ayah_number: small() };
    await queryInterface.createTable('quran_juz', { juz_number: { ...small(), primaryKey: true }, ...division }, TABLE_OPTIONS);
    await queryInterface.createTable('quran_hizb', { hizb_number: { ...small(), primaryKey: true }, juz_number: small(), ...division }, TABLE_OPTIONS);
    await queryInterface.createTable('quran_quarters', { quarter_number: { ...small(), primaryKey: true }, hizb_number: small(), juz_number: small(), ...division }, TABLE_OPTIONS);
    await queryInterface.addIndex('quran_quarters', ['start_global_ayah'], { unique: true, name: 'uq_quran_quarters_start' });
    await q('ALTER TABLE quran_juz ADD CONSTRAINT ck_quran_juz CHECK (juz_number BETWEEN 1 AND 30)');
    await q('ALTER TABLE quran_hizb ADD CONSTRAINT ck_quran_hizb CHECK (hizb_number BETWEEN 1 AND 60 AND juz_number = CEIL(hizb_number / 2))');
    await q('ALTER TABLE quran_quarters ADD CONSTRAINT ck_quran_quarters CHECK (quarter_number BETWEEN 1 AND 240 AND hizb_number = CEIL(quarter_number / 4) AND juz_number = CEIL(quarter_number / 8))');
  },

  async down(queryInterface) {
    for (const table of ['quran_quarters', 'quran_hizb', 'quran_juz', 'quran_lines', 'quran_ayahs', 'quran_pages', 'quran_surahs', 'quran_dataset_imports']) await queryInterface.dropTable(table);
  },
};
