/**
 * Real-database checks for Module 21 (Quran Structure): the schema (keys, CHECKs, the single ACTIVE import), the SQL repository against the SYNTHETIC
 * dataset (parity with the in-memory repository), the import use case (import, idempotent re-run, confirmed replacement) and atomic rollback of a
 * failed replacement. NOT part of `npm test`. Prerequisite: `npm run db:migrate`. Run: npm run test:db
 * Safe on any database, including one that already holds the real Quran dataset: every test runs in ONE outer transaction that is ALWAYS rolled
 * back, so existing data is never changed. The synthetic dataset is never committed.
 */
import { QueryTypes, type Sequelize } from 'sequelize';
import { afterAll, describe, expect, it } from 'vitest';
import { env } from '../../src/config/env';
import { AppError, SystemClock, type UnitOfWork } from '../../src/modules/00-shared-kernel/public';
import { SequelizeUnitOfWork, createSequelize, sequelizeTransactionOf } from '../../src/modules/02-database/public';
import { ImportQuranDataset, QuranStructureService, SequelizeQuranStructureRepository } from '../../src/modules/21-quran-structure/public';
import { buildSyntheticDataset } from '../helpers/quran-fixture';
import { createQuranHarness, validateSynthetic } from '../helpers/quran-service-harness';

const sequelize = createSequelize(env.database);
const uow = new SequelizeUnitOfWork(sequelize);

class Rollback extends Error {}
const swallowRollback = (error: unknown) => {
  if (!(error instanceof Rollback)) throw error;
};

async function withFixture(work: (f: Awaited<ReturnType<typeof fixture>>) => Promise<void>): Promise<void> {
  try {
    await uow.run(async (tx) => {
      await work(await fixture(tx));
      throw new Rollback();
    });
  } catch (error) {
    swallowRollback(error);
  }
}

async function fixture(tx: Parameters<Parameters<UnitOfWork['run']>[0]>[0]) {
  const transaction = sequelizeTransactionOf(tx) ?? null;
  const q = <T extends object>(sql: string, replacements: Record<string, unknown> = {}) => sequelize.query<T>(sql, { replacements, type: QueryTypes.SELECT, transaction });
  const run = async (sql: string, replacements: Record<string, unknown> = {}) => {
    await sequelize.query(sql, { replacements, transaction });
  };
  let sp = 0;
  /** The statement must fail (a constraint); the transaction stays usable (savepoint). */
  const fails = async (sql: string, replacements: Record<string, unknown> = {}) => {
    const name = `sp_${++sp}`;
    await run(`SAVEPOINT ${name}`);
    await expect(run(sql, replacements)).rejects.toThrow();
    await run(`ROLLBACK TO SAVEPOINT ${name}`);
  };
  // every query of the repository runs in the test's transaction
  const scoped = { query: (sql: never, options: Record<string, unknown> = {}) => sequelize.query(sql, { ...options, transaction: options.transaction ?? transaction } as never) } as unknown as Sequelize;
  const repository = new SequelizeQuranStructureRepository(scoped);
  const service = new QuranStructureService(repository);
  let operation = 0;
  const savepointUnitOfWork: UnitOfWork = {
    run: async (inner) => {
      const name = `op_${++operation}`;
      await run(`SAVEPOINT ${name}`);
      try {
        const result = await inner(tx);
        await run(`RELEASE SAVEPOINT ${name}`);
        return result;
      } catch (error) {
        await run(`ROLLBACK TO SAVEPOINT ${name}`);
        throw error;
      }
    },
  };
  const importer = new ImportQuranDataset({ store: repository, unitOfWork: savepointUnitOfWork, clock: new SystemClock() });
  const importSynthetic = (options: { checksum?: string; replace?: boolean; mutate?: (raw: Record<string, unknown>) => void } = {}) => {
    const raw = buildSyntheticDataset();
    options.mutate?.(raw);
    return importer.execute({ raw, checksum: options.checksum ?? 'a'.repeat(64), replace: options.replace ?? false }, validateSynthetic);
  };
  return { q, run, fails, repository, service, importer, importSynthetic, tx };
}

afterAll(async () => {
  await sequelize.close();
});

describe('Module 21 schema', () => {
  it('rejects rows that violate the CHECKs and keys', async () => {
    await withFixture(async ({ run, fails }) => {
      for (const table of ['quran_lines', 'quran_pages', 'quran_ayahs', 'quran_quarters', 'quran_quarter_marks', 'quran_juz', 'quran_surahs']) await run(`DELETE FROM ${table}`); // allowed inside the rolled-back transaction
      await fails("INSERT INTO quran_surahs (surah_number, name_ar, ayah_count, first_global_ayah) VALUES (115, 'x', 3, 1)");
      await fails("INSERT INTO quran_surahs (surah_number, name_ar, ayah_count, first_global_ayah) VALUES (1, 'x', 0, 1)");
      await run("INSERT INTO quran_surahs (surah_number, name_ar, ayah_count, first_global_ayah) VALUES (1, 'x', 7, 1)");
      await fails("INSERT INTO quran_surahs (surah_number, name_ar, ayah_count, first_global_ayah) VALUES (2, 'y', 7, 1)"); // first_global_ayah unique
      const ayah = (surah: number, firstPage: number, lastPage: number, juz: number, marker: number, text: string | null = "'t'", quarter = 1) =>
        `INSERT INTO quran_ayahs (global_ayah, surah_number, ayah_number, ayah_text, first_page, first_line, last_page, last_line, juz_number, quarter_number, has_rub_marker) VALUES (1, ${surah}, 1, ${text}, ${firstPage}, 1, ${lastPage}, 1, ${juz}, ${quarter}, ${marker})`;
      await fails(ayah(2, 1, 1, 1, 0)); // surah 2 does not exist (FK)
      await fails(ayah(1, 0, 1, 1, 0)); // page 0
      await fails(ayah(1, 5, 4, 1, 0)); // last before first
      await fails(ayah(1, 1, 1, 0, 0)); // juz 0
      await fails(ayah(1, 1, 1, 31, 0)); // juz 31
      await fails(ayah(1, 1, 1, 1, 2)); // marker flag out of range
      await fails(ayah(1, 1, 1, 1, 0, 'NULL')); // the official text is required
      await fails(ayah(1, 1, 1, 1, 0, "'t'", 0)); // quarter 0
      await fails(ayah(1, 1, 1, 1, 0, "'t'", 241)); // quarter 241
      await fails("INSERT INTO quran_pages (page_number, line_count, first_global_ayah, last_global_ayah) VALUES (605, 5, 1, 2)");
      await run('INSERT INTO quran_pages (page_number, line_count, first_global_ayah, last_global_ayah) VALUES (1, 5, 1, 7)');
      await fails("INSERT INTO quran_lines (global_line, page_number, line_number, kind, surah_number, first_global_ayah, last_global_ayah) VALUES (1, 1, 1, 'TEXT', NULL, NULL, NULL)"); // text without ayahs
      await fails("INSERT INTO quran_lines (global_line, page_number, line_number, kind, surah_number, first_global_ayah, last_global_ayah) VALUES (1, 1, 1, 'SURAH_HEADER', NULL, NULL, NULL)"); // banner without surah
      await fails("INSERT INTO quran_lines (global_line, page_number, line_number, kind, surah_number, first_global_ayah, last_global_ayah) VALUES (1, 1, 1, 'FOOTER', 1, NULL, NULL)");
      await fails("INSERT INTO quran_lines (global_line, page_number, line_number, kind, surah_number, first_global_ayah, last_global_ayah) VALUES (1, 2, 1, 'SURAH_HEADER', 1, NULL, NULL)"); // page 2 does not exist (FK)
      await run("INSERT INTO quran_lines (global_line, page_number, line_number, kind, surah_number, first_global_ayah, last_global_ayah) VALUES (1, 1, 1, 'SURAH_HEADER', 1, NULL, NULL)");
      await fails("INSERT INTO quran_lines (global_line, page_number, line_number, kind, surah_number, first_global_ayah, last_global_ayah) VALUES (2, 1, 1, 'BASMALA', 1, NULL, NULL)"); // (page, line) unique
      const juz = (n: number, verification: string) => `INSERT INTO quran_juz (juz_number, verification, start_global_ayah, start_surah_number, start_ayah_number) VALUES (${n}, '${verification}', 1, 1, 1)`;
      await fails(juz(31, 'MARKER_CONFIRMED')); // juz 31
      await fails(juz(1, 'GUESSED')); // only the three evidence statuses exist
      for (const status of ['MARKER_CONFIRMED', 'SURAH_START_NO_MARKER', 'MARKER_CONFLICT']) {
        await run(juz(status === 'MARKER_CONFIRMED' ? 1 : status === 'SURAH_START_NO_MARKER' ? 2 : 3, status));
      }
      const quarter = (n: number, hizb: number, juzOfQuarter: number, g: number) => `INSERT INTO quran_quarters (quarter_number, hizb_number, juz_number, start_global_ayah, start_surah_number, start_ayah_number) VALUES (${n}, ${hizb}, ${juzOfQuarter}, ${g}, 1, 1)`;
      await fails(quarter(0, 1, 1, 1)); // quarters are 1..240
      await fails(quarter(241, 61, 31, 1));
      await fails(quarter(5, 3, 1, 1)); // the hizb of quarter 5 is 2
      await fails(quarter(9, 3, 1, 1)); // the position of quarter 9 is in juz 2
      await run(quarter(1, 1, 1, 1));
      await fails(quarter(2, 1, 1, 1)); // two quarters cannot start at the same ayah
      const mark = (n: number, g: number) => `INSERT INTO quran_quarter_marks (mark_number, start_global_ayah, start_surah_number, start_ayah_number) VALUES (${n}, ${g}, 1, 1)`;
      await fails(mark(0, 1)); // ordinal starts at 1
      await fails(mark(241, 1)); // never more markers than quarters
      await fails(mark(1, 6237)); // global position beyond the last ayah
      await run(mark(1, 33));
      await fails(mark(2, 33)); // one marker per ayah
    });
  });

  it('allows exactly one ACTIVE import', async () => {
    await withFixture(async ({ run, fails, q }) => {
      await run("UPDATE quran_dataset_imports SET status = 'SUPERSEDED', active = NULL WHERE active = 1");
      const insert = (id: string, status: string, active: number | null) =>
        `INSERT INTO quran_dataset_imports (id, edition_code, source_provider, source_name, checksum, surah_count, ayah_count, page_count, line_count, quarter_count, quarter_mark_count, status, active, imported_at) VALUES ('${id}', 'E', 'p', 'n', '${'a'.repeat(64)}', 114, 6236, 604, 9000, 240, 199, '${status}', ${active}, UTC_TIMESTAMP(3))`;
      await run(insert('11111111-1111-4111-8111-111111111111', 'ACTIVE', 1));
      await fails(insert('22222222-2222-4222-8222-222222222222', 'ACTIVE', 1)); // a second active import
      await run(insert('33333333-3333-4333-8333-333333333333', 'SUPERSEDED', null));
      await run(insert('44444444-4444-4444-8444-444444444444', 'SUPERSEDED', null)); // any number of superseded
      await fails(insert('55555555-5555-4555-8555-555555555555', 'ACTIVE', null)); // ACTIVE needs active = 1
      expect((await q<{ n: number }>('SELECT COUNT(*) AS n FROM quran_dataset_imports WHERE active = 1'))[0]!.n).toBe(1);
    });
  });
});

describe('SequelizeQuranStructureRepository + ImportQuranDataset (real database, synthetic dataset)', () => {
  it('imports, then serves exactly what the in-memory implementation serves (parity)', async () => {
    await withFixture(async ({ importSynthetic, service, repository, q }) => {
      const summary = await importSynthetic();
      expect(summary).toMatchObject({ outcome: expect.stringMatching(/IMPORTED|REPLACED/), counts: { surahs: 114, ayahs: 6236, pages: 604, quarters: 240, quarterMarks: 162 } });
      const memory = createQuranHarness();
      await memory.importSynthetic();

      expect(await service.listSurahs()).toEqual(await memory.service.listSurahs());
      for (const [surah, ayah] of [[1, 1], [2, 255], [3, 10], [114, 6]] as const) expect(await service.getAyah(surah, ayah)).toEqual(await memory.service.getAyah(surah, ayah));
      for (const position of [1, 8, 6236]) expect(await service.getAyahByGlobalPosition(position)).toEqual(await memory.service.getAyahByGlobalPosition(position));
      for (const page of [1, 2, 300, 604]) expect(await service.getPage(page)).toEqual(await memory.service.getPage(page));
      expect(await service.getLineByGlobalIndex(100)).toEqual(await memory.service.getLineByGlobalIndex(100));
      expect(await service.listJuzs()).toEqual(await memory.service.listJuzs());
      expect(await service.listQuarters()).toEqual(await memory.service.listQuarters());
      expect(await service.getQuarter(106)).toEqual(await memory.service.getQuarter(106));
      expect(await service.listQuarterMarks()).toEqual(await memory.service.listQuarterMarks());
      expect(await service.listAyahsOfSurah(2, { page: 2, pageSize: 40 }, 'desc')).toEqual(await memory.service.listAyahsOfSurah(2, { page: 2, pageSize: 40 }, 'desc'));
      expect(await service.getSurah(115)).toBeUndefined();
      expect(await service.getAyah(1, 8)).toBeUndefined();
      expect(await service.getPage(605)).toBeUndefined();

      const info = await service.getDatasetInfo();
      expect(info).toMatchObject({ editionCode: 'SYNTHETIC_TEST_EDITION', source: { provider: 'SYNTHETIC TEST DATA', retrievedOn: '2026-10-22' }, checksum: 'a'.repeat(64) });
      expect(info!.source.files).toEqual([{ name: 'synthetic.json', sha256: 'a'.repeat(64) }]); // attribution survives the round trip
      const counts = await q<{ n: number }>('SELECT (SELECT COUNT(*) FROM quran_surahs) + (SELECT COUNT(*) FROM quran_ayahs) + (SELECT COUNT(*) FROM quran_pages) + (SELECT COUNT(*) FROM quran_quarters) + (SELECT COUNT(*) FROM quran_quarter_marks) + (SELECT COUNT(*) FROM quran_juz) AS n');
      expect(Number(counts[0]!.n)).toBe(114 + 6236 + 604 + 240 + 162 + 30);
      expect((await repository.findActiveImport())!.counts.lines).toBe((await memory.repository.findActiveImport())!.counts.lines);
      expect((await q<{ n: number }>('SELECT (SELECT COUNT(*) FROM quran_hizb) AS n'))[0]!.n).toBe(0); // the reserved hizb table stays empty
    });
  });

  it('is idempotent, refuses an unconfirmed replacement, and replaces on request keeping the previous import as SUPERSEDED', async () => {
    await withFixture(async ({ importSynthetic, repository, q }) => {
      await importSynthetic();
      expect((await importSynthetic()).outcome).toBe('UNCHANGED');
      await expect(importSynthetic({ checksum: 'b'.repeat(64) })).rejects.toMatchObject({ code: 'QURAN_DATASET_REPLACEMENT_NOT_CONFIRMED' });
      expect((await repository.findActiveImport())!.checksum).toBe('a'.repeat(64));
      expect((await importSynthetic({ checksum: 'b'.repeat(64), replace: true, mutate: (d) => ((d.source as Record<string, unknown>).version = '2') })).outcome).toBe('REPLACED');
      expect(await repository.findActiveImport()).toMatchObject({ checksum: 'b'.repeat(64), source: { version: '2' } });
      const history = await q<{ status: string; checksum: string }>("SELECT status, checksum FROM quran_dataset_imports WHERE checksum IN (:a, :b) ORDER BY imported_at", { a: 'a'.repeat(64), b: 'b'.repeat(64) });
      expect(history.map((h) => h.status)).toEqual(['SUPERSEDED', 'ACTIVE']);
    });
  });

  it('rolls a failed replacement back completely: the previous dataset stays whole and active', async () => {
    await withFixture(async ({ importSynthetic, importer, repository, service, q }) => {
      await importSynthetic();
      const before = await service.getAyah(2, 255);
      // passes validation, then violates a CHECK in the database part-way through the inserts
      const corrupt = (raw: unknown) => {
        const valid = validateSynthetic(raw);
        return { ...valid, ayahs: valid.ayahs.map((a, i) => (i === 5000 ? { ...a, firstPage: 0 } : a)) };
      };
      await expect(importer.execute({ raw: buildSyntheticDataset(), checksum: 'c'.repeat(64), replace: true }, corrupt)).rejects.toThrow();
      expect((await repository.findActiveImport())!.checksum).toBe('a'.repeat(64));
      expect(await service.getAyah(2, 255)).toEqual(before);
      expect(Number((await q<{ n: number }>('SELECT COUNT(*) AS n FROM quran_ayahs'))[0]!.n)).toBe(6236);
      expect(Number((await q<{ n: number }>('SELECT COUNT(*) AS n FROM quran_dataset_imports WHERE active = 1'))[0]!.n)).toBe(1);
      expect(Number((await q<{ n: number }>("SELECT COUNT(*) AS n FROM quran_dataset_imports WHERE checksum = :c", { c: 'c'.repeat(64) }))[0]!.n)).toBe(0);
    });
  });

  it('answers QURAN_DATASET_NOT_IMPORTED while no import is active', async () => {
    await withFixture(async ({ run, service }) => {
      await run("UPDATE quran_dataset_imports SET status = 'SUPERSEDED', active = NULL WHERE active = 1");
      await expect(service.listSurahs()).rejects.toBeInstanceOf(AppError);
      await expect(service.listSurahs()).rejects.toMatchObject({ code: 'QURAN_DATASET_NOT_IMPORTED' });
    });
  });
});
