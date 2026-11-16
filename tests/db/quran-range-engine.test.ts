/**
 * Real-database check for Module 22 (Quran Range Engine): the engine over the MariaDB repository (Module 21's SQL implementation) must give exactly
 * the answers it gives over the in-memory implementation, for every unit and direction, including the errors. The engine has no tables of its own.
 * NOT part of `npm test`. Prerequisite: `npm run db:migrate`. Run: npm run test:db
 * Safe on any database, including one that already holds the real Quran dataset: the test runs in ONE transaction that is ALWAYS rolled back, and the
 * synthetic dataset is imported inside it (after emptying the dataset tables inside that same transaction), so existing data is never changed.
 */
import { QueryTypes, type Sequelize } from 'sequelize';
import { afterAll, describe, expect, it } from 'vitest';
import { env } from '../../src/config/env';
import { AppError, SystemClock, type UnitOfWork } from '../../src/modules/00-shared-kernel/public';
import { SequelizeUnitOfWork, createSequelize, sequelizeTransactionOf } from '../../src/modules/02-database/public';
import { ImportQuranDataset, QuranStructureService, SequelizeQuranStructureRepository } from '../../src/modules/21-quran-structure/public';
import { QuranRangeEngine, type QuranRangeRequest, type RangeDirection, type RangeUnit } from '../../src/modules/22-quran-range-engine/public';
import { buildSyntheticDataset } from '../helpers/quran-fixture';
import { createQuranHarness, validateSynthetic } from '../helpers/quran-service-harness';

const sequelize = createSequelize(env.database);
const uow = new SequelizeUnitOfWork(sequelize);

class Rollback extends Error {}

async function withDatabaseQuran(work: (service: QuranStructureService) => Promise<void>): Promise<void> {
  try {
    await uow.run(async (tx) => {
      const transaction = sequelizeTransactionOf(tx) ?? null;
      const run = async (sql: string) => {
        await sequelize.query(sql, { transaction, type: QueryTypes.RAW });
      };
      // make the database look empty for this test only (rolled back at the end)
      await run("UPDATE quran_dataset_imports SET status = 'SUPERSEDED', active = NULL WHERE active = 1");
      for (const table of ['quran_lines', 'quran_pages', 'quran_ayahs', 'quran_quarters', 'quran_quarter_marks', 'quran_juz', 'quran_surahs']) await run(`DELETE FROM ${table}`);
      const scoped = { query: (sql: never, options: Record<string, unknown> = {}) => sequelize.query(sql, { ...options, transaction: options.transaction ?? transaction } as never) } as unknown as Sequelize;
      const repository = new SequelizeQuranStructureRepository(scoped);
      let operation = 0;
      const savepoints: UnitOfWork = {
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
      const importer = new ImportQuranDataset({ store: repository, unitOfWork: savepoints, clock: new SystemClock() });
      await importer.execute({ raw: buildSyntheticDataset(), checksum: 'd'.repeat(64), replace: false }, validateSynthetic);
      await work(new QuranStructureService(repository));
      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
}

afterAll(async () => {
  await sequelize.close();
});

async function answer(engine: QuranRangeEngine, request: QuranRangeRequest): Promise<unknown> {
  try {
    return await engine.calculate(request);
  } catch (error) {
    if (error instanceof AppError) return { error: error.code, kind: error.kind, details: error.details };
    throw error;
  }
}

describe('QuranRangeEngine over the real database', () => {
  it('answers exactly like the in-memory implementation for every unit and direction, errors included', async () => {
    const memory = createQuranHarness();
    await memory.importSynthetic();
    const inMemory = new QuranRangeEngine(memory.service);
    const units: RangeUnit[] = ['SURAHS', 'AYAHS', 'QUARTERS', 'PAGES', 'LINES'];
    const directions: RangeDirection[] = ['FORWARD', 'BACKWARD'];
    const starts: QuranRangeRequest['start'][] = [{ surah: 1 }, { surah: 1, ayah: 1 }, { surah: 2, ayah: 255 }, { surah: 2 }, { surah: 9, ayah: 129 }, { surah: 36, ayah: 40 }, { surah: 113 }, { surah: 114 }, { surah: 114, ayah: 1 }, { surah: 114, ayah: 6 }];
    const amounts = [1, 3, 10, 120];

    await withDatabaseQuran(async (database) => {
      const engine = new QuranRangeEngine(database);
      let compared = 0;
      for (const unit of units) {
        for (const direction of directions) {
          for (const start of starts) {
            for (const amount of amounts) {
              const request: QuranRangeRequest = { unit, direction, amount, start };
              expect(await answer(engine, request), JSON.stringify(request)).toEqual(await answer(inMemory, request));
              compared += 1;
            }
          }
        }
      }
      expect(compared).toBe(5 * 2 * 10 * 4);

      // the approved examples, on the real database
      const nas = await engine.calculate({ unit: 'AYAHS', direction: 'BACKWARD', amount: 10, start: { surah: 114 } });
      expect(nas.segments.map((s) => `${s.surah}:${s.firstAyah}-${s.lastAyah}`)).toEqual(['113:2-5', '114:1-6']);
      const surahs = await engine.calculate({ unit: 'SURAHS', direction: 'BACKWARD', amount: 3, start: { surah: 114 } });
      expect(surahs.segments.map((s) => `${s.surah}:${s.firstAyah}-${s.lastAyah}`)).toEqual(['112:1-4', '113:1-5', '114:1-6']);
      const baqarah = await engine.calculate({ unit: 'SURAHS', direction: 'FORWARD', amount: 1, start: { surah: 2, ayah: 255 } });
      expect(baqarah.segments).toEqual([{ surah: 2, firstAyah: 1, lastAyah: 286, ayahCount: 286, complete: true }]);
    });
    // 400 sequential engine calls over MariaDB plus emptying and re-importing the dataset tables inside the transaction; on a database that
    // already holds the real dataset this took ~15.2 s, just over the global 15 s limit (a timeout, not a wrong answer).
  }, 120_000);

  it('passes QURAN_DATASET_NOT_IMPORTED through when no dataset is active', async () => {
    try {
      await uow.run(async (tx) => {
        const transaction = sequelizeTransactionOf(tx) ?? null;
        await sequelize.query("UPDATE quran_dataset_imports SET status = 'SUPERSEDED', active = NULL WHERE active = 1", { transaction, type: QueryTypes.RAW });
        const scoped = { query: (sql: never, options: Record<string, unknown> = {}) => sequelize.query(sql, { ...options, transaction: options.transaction ?? transaction } as never) } as unknown as Sequelize;
        const engine = new QuranRangeEngine(new QuranStructureService(new SequelizeQuranStructureRepository(scoped)));
        expect(await answer(engine, { unit: 'AYAHS', direction: 'FORWARD', amount: 1, start: { surah: 1 } })).toMatchObject({ error: 'QURAN_DATASET_NOT_IMPORTED' });
        throw new Rollback();
      });
    } catch (error) {
      if (!(error instanceof Rollback)) throw error;
    }
  });
});
