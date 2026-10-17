/**
 * Real-database checks for Module 14 (Geography). Prerequisite: `npm run db:migrate`. Run: npm run test:db
 * Safe on any database: every test runs inside ONE outer transaction that is ALWAYS rolled back (the geography tables are
 * emptied only inside that transaction), and every read/write passes that transaction explicitly. Real seeded data is
 * never changed. NOTE: once later modules add foreign keys to these tables (schools, addresses), the emptying step must be
 * revisited because it would then be blocked by ON DELETE RESTRICT.
 */
import { QueryTypes } from 'sequelize';
import { afterAll, describe, expect, it } from 'vitest';
import { env } from '../../src/config/env';
import { AppError, type Clock, type TransactionContext } from '../../src/modules/00-shared-kernel/public';
import { SequelizeUnitOfWork, createSequelize, sequelizeTransactionOf } from '../../src/modules/02-database/public';
import {
  EGYPT_GOVERNORATE_NAMES,
  GeographyNode,
  GeographyService,
  SeedEgyptGeography,
  SequelizeGeographyRepository,
  type CenterKind,
  type GeographyLevel,
} from '../../src/modules/14-geography/public';

const sequelize = createSequelize(env.database);
const uow = new SequelizeUnitOfWork(sequelize);
const repository = new SequelizeGeographyRepository(sequelize);
const service = new GeographyService(repository);
const seeder = new SeedEgyptGeography({ repository, unitOfWork: uow });
const clock: Clock = { now: () => new Date() };

class Rollback extends Error {}
type Q = <T extends object>(sql: string, replacements?: Record<string, string>) => Promise<T[]>;

/** Runs `work` on EMPTY geography tables (inside the transaction only) and always rolls back. An assigned organization country is detached first (inside the transaction only). */
async function inRollback(work: (tx: TransactionContext, q: Q) => Promise<void>): Promise<void> {
  try {
    await uow.run(async (tx) => {
      const transaction = sequelizeTransactionOf(tx) ?? null;
      const q: Q = <T extends object>(sql: string, replacements: Record<string, string> = {}) =>
        sequelize.query<T>(sql, { replacements, type: QueryTypes.SELECT, transaction });
      // Module 16: schools reference organizations and geography (RESTRICT); clear them inside this rolled-back transaction first.
      for (const table of ['school_classification_archive', 'school_manager_source_archive', 'school_gps_history', 'school_status_history', 'school_managers']) await sequelize.query(`DELETE FROM ${table}`, { transaction: transaction });
      await sequelize.query('DELETE FROM schools', { transaction: transaction });
      await sequelize.query('DELETE FROM organization_admins', { transaction: transaction });
      // organizations reference countries and the governorate (RESTRICT): detach them inside this always-rolled-back transaction only.
      await sequelize.query('UPDATE organizations SET village_name = NULL, center_name = NULL, governorate_id = NULL, country_id = NULL', { transaction });
      for (const table of ['villages', 'centers', 'governorates', 'countries']) await sequelize.query(`DELETE FROM ${table}`, { transaction });
      for (const table of ['countries', 'governorates', 'centers', 'villages']) {
        const left = await q<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`);
        if (Number(left[0]?.n) !== 0) throw new Error(`Test precondition failed: ${table} is not empty inside the test transaction`);
      }
      await work(tx, q);
      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
}

let seq = 0;
const PREFIX: Record<GeographyLevel, string> = { COUNTRY: 'CNT', GOVERNORATE: 'GOV', CENTER: 'CTR', VILLAGE: 'VIL' };
const add = async (tx: TransactionContext, level: GeographyLevel, name: string, parentId: string | null, kind?: CenterKind) => {
  const node = GeographyNode.create({ level, name, parentId, kind, code: `${PREFIX[level]}-${String(100000 + ++seq)}`, clock });
  await repository.insert(node, tx);
  return node;
};
const codeOf = (p: Promise<unknown>) => p.then(() => 'NO_ERROR', (e: unknown) => (e instanceof AppError ? e.code : `RAW:${(e as Error).name}`));
const raw = (tx: TransactionContext, sql: string, replacements: Record<string, string | number> = {}) =>
  sequelize.query(sql, { replacements, transaction: sequelizeTransactionOf(tx) ?? null });
const NOW = 'UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)';
const ID = (n: number) => `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;

afterAll(async () => {
  await sequelize.close();
});

describe('geography schema (migration)', () => {
  it('has the approved columns only, no organization_id, utf8mb4 names and the expected unique indexes', async () => {
    const cols = async (table: string) =>
      (
        await sequelize.query<{ COLUMN_NAME: string }>(
          'SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :table ORDER BY ORDINAL_POSITION',
          { replacements: { table }, type: QueryTypes.SELECT },
        )
      ).map((c) => c.COLUMN_NAME);
    expect(await cols('countries')).toEqual(['id', 'code', 'name', 'status', 'created_at', 'updated_at']);
    expect(await cols('governorates')).toEqual(['id', 'code', 'name', 'status', 'country_id', 'created_at', 'updated_at']);
    expect(await cols('centers')).toEqual(['id', 'code', 'name', 'status', 'governorate_id', 'kind', 'created_at', 'updated_at']);
    expect(await cols('villages')).toEqual(['id', 'code', 'name', 'status', 'center_id', 'created_at', 'updated_at']);

    const unique = await sequelize.query<{ TABLE_NAME: string; INDEX_NAME: string }>(
      `SELECT DISTINCT TABLE_NAME, INDEX_NAME FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('countries','governorates','centers','villages') AND NON_UNIQUE = 0 AND INDEX_NAME <> 'PRIMARY'`,
      { type: QueryTypes.SELECT },
    );
    expect(unique.map((u) => u.INDEX_NAME).sort()).toEqual([
      'uq_centers_code', 'uq_centers_name', 'uq_countries_code', 'uq_countries_name',
      'uq_governorates_code', 'uq_governorates_name', 'uq_villages_code', 'uq_villages_name',
    ]);
    const names = await sequelize.query<{ CHARACTER_SET_NAME: string }>(
      `SELECT CHARACTER_SET_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND COLUMN_NAME = 'name'
        AND TABLE_NAME IN ('countries','governorates','centers','villages')`,
      { type: QueryTypes.SELECT },
    );
    expect(names).toHaveLength(4);
    expect(names.every((n) => n.CHARACTER_SET_NAME === 'utf8mb4')).toBe(true);
  });

  it('links each level to its parent with a real foreign key, ON DELETE RESTRICT and ON UPDATE RESTRICT', async () => {
    const fks = await sequelize.query<{ TABLE_NAME: string; REFERENCED_TABLE_NAME: string; DELETE_RULE: string; UPDATE_RULE: string }>(
      `SELECT TABLE_NAME, REFERENCED_TABLE_NAME, DELETE_RULE, UPDATE_RULE FROM information_schema.REFERENTIAL_CONSTRAINTS
        WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME IN ('countries','governorates','centers','villages') ORDER BY TABLE_NAME`,
      { type: QueryTypes.SELECT },
    );
    expect(fks.map((f) => `${f.TABLE_NAME}->${f.REFERENCED_TABLE_NAME}`)).toEqual(['centers->governorates', 'governorates->countries', 'villages->centers']);
    expect(fks.every((f) => f.DELETE_RULE === 'RESTRICT' && f.UPDATE_RULE === 'RESTRICT')).toBe(true);
  });
});

describe('SeedEgyptGeography and GeographyService (MariaDB)', () => {
  it('seeds Egypt and 27 governorates, stores Arabic names exactly, and is idempotent', async () => {
    await inRollback(async (tx, q) => {
      const first = await seeder.execute(tx);
      expect(first).toEqual({ country: { code: 'CNT-000001', created: true }, governorates: { total: 27, created: 27, existing: 0 } });
      const again = await seeder.execute(tx);
      expect(again).toEqual({ country: { code: 'CNT-000001', created: false }, governorates: { total: 27, created: 0, existing: 27 } });

      const [egypt] = await service.listCountries(tx);
      expect(egypt).toMatchObject({ name: 'مصر', status: 'ACTIVE', parentId: null });
      const governorates = await service.listGovernorates(egypt!.id, tx);
      expect(governorates.map((g) => g.name)).toEqual([...EGYPT_GOVERNORATE_NAMES]);
      expect(governorates[0]!.code).toBe('GOV-000001');
      expect(await q('SELECT id FROM countries')).toHaveLength(1);
      expect(await q('SELECT id FROM governorates')).toHaveLength(27);
      expect(await q('SELECT id FROM centers')).toHaveLength(0);
      expect(await q('SELECT id FROM villages')).toHaveLength(0);
    });
  });

  it('validates hierarchies against the real tables (including the same name as both a center and a city)', async () => {
    await inRollback(async (tx) => {
      const country = await add(tx, 'COUNTRY', 'مصر', null);
      const gov = await add(tx, 'GOVERNORATE', 'الدقهلية', country.id);
      const gov2 = await add(tx, 'GOVERNORATE', 'الغربية', country.id);
      const center = await add(tx, 'CENTER', 'المنصورة', gov.id, 'CENTER');
      const city = await add(tx, 'CENTER', 'المنصورة', gov.id, 'CITY');
      const other = await add(tx, 'CENTER', 'طنطا', gov2.id, 'CITY');
      const village = await add(tx, 'VILLAGE', 'ميت غمر', center.id);

      const ok = await service.validateHierarchy({ governorateId: gov.id, centerId: center.id, villageId: village.id }, {}, tx);
      expect(ok).toMatchObject({ country: { id: country.id }, governorate: { id: gov.id }, center: { id: center.id, kind: 'CENTER' }, village: { id: village.id } });
      expect((await service.getCenter(city.id, tx))?.kind).toBe('CITY');
      expect(await codeOf(service.validateHierarchy({ governorateId: gov.id, centerId: other.id }, {}, tx))).toBe('INVALID_GEOGRAPHY_HIERARCHY');
      expect(await codeOf(service.validateHierarchy({ governorateId: gov.id, villageId: village.id }, {}, tx))).toBe('INVALID_GEOGRAPHY_HIERARCHY');
      expect(await codeOf(service.validateHierarchy({ governorateId: gov.id, centerId: city.id, villageId: village.id }, {}, tx))).toBe('INVALID_GEOGRAPHY_HIERARCHY');
      expect(await codeOf(service.validateHierarchy({ governorateId: ID(9) }, {}, tx))).toBe('GEOGRAPHY_NODE_NOT_FOUND');
    });
  });
});

describe('database guards', () => {
  it('ON DELETE RESTRICT: a parent with children cannot be deleted, at every level', async () => {
    await inRollback(async (tx) => {
      const country = await add(tx, 'COUNTRY', 'مصر', null);
      const gov = await add(tx, 'GOVERNORATE', 'الدقهلية', country.id);
      const center = await add(tx, 'CENTER', 'المنصورة', gov.id, 'CENTER');
      await add(tx, 'VILLAGE', 'ميت غمر', center.id);
      await expect(raw(tx, 'DELETE FROM centers WHERE id = :id', { id: center.id })).rejects.toThrow();
      await expect(raw(tx, 'DELETE FROM governorates WHERE id = :id', { id: gov.id })).rejects.toThrow();
      await expect(raw(tx, 'DELETE FROM countries WHERE id = :id', { id: country.id })).rejects.toThrow();
    });
  });

  it('foreign key: a node cannot reference a missing parent (repository maps it to GEOGRAPHY_PARENT_NOT_FOUND)', async () => {
    await inRollback(async (tx) => {
      const orphan = GeographyNode.create({ level: 'GOVERNORATE', name: 'يتيمة', code: 'GOV-000001', parentId: ID(7), clock });
      expect(await codeOf(repository.insert(orphan, tx))).toBe('GEOGRAPHY_PARENT_NOT_FOUND');
      await expect(raw(tx, `INSERT INTO villages (id, code, name, status, center_id, created_at, updated_at) VALUES (:id, 'VIL-000001', 'x', 'ACTIVE', :parent, ${NOW})`, { id: ID(1), parent: ID(2) })).rejects.toThrow();
    });
  });

  it('unique names: per parent (country-wide for countries) and per parent AND kind for centers/cities', async () => {
    await inRollback(async (tx) => {
      const country = await add(tx, 'COUNTRY', 'مصر', null);
      expect(await codeOf(add(tx, 'COUNTRY', 'مصر', null))).toBe('GEOGRAPHY_NODE_ALREADY_EXISTS');
      const gov = await add(tx, 'GOVERNORATE', 'الدقهلية', country.id);
      expect(await codeOf(add(tx, 'GOVERNORATE', 'الدقهلية', country.id))).toBe('GEOGRAPHY_NODE_ALREADY_EXISTS');
      const center = await add(tx, 'CENTER', 'المنصورة', gov.id, 'CENTER');
      await add(tx, 'CENTER', 'المنصورة', gov.id, 'CITY'); // other kind: allowed
      expect(await codeOf(add(tx, 'CENTER', 'المنصورة', gov.id, 'CENTER'))).toBe('GEOGRAPHY_NODE_ALREADY_EXISTS');
      const center2 = await add(tx, 'CENTER', 'طلخا', gov.id, 'CENTER');
      await add(tx, 'VILLAGE', 'ميت غمر', center.id);
      await add(tx, 'VILLAGE', 'ميت غمر', center2.id); // same name under another center: allowed
      expect(await codeOf(add(tx, 'VILLAGE', 'ميت غمر', center.id))).toBe('GEOGRAPHY_NODE_ALREADY_EXISTS');
    });
  });

  it('unique codes per table', async () => {
    await inRollback(async (tx) => {
      const country = await add(tx, 'COUNTRY', 'مصر', null);
      const dup = GeographyNode.create({ level: 'COUNTRY', name: 'دولة أخرى', code: country.code, parentId: null, clock });
      expect(await codeOf(repository.insert(dup, tx))).toBe('GEOGRAPHY_NODE_ALREADY_EXISTS');
    });
  });

  it.each([
    ['countries lowercase code', "INSERT INTO countries (id, code, name, status, created_at, updated_at) VALUES (:id, 'cnt-000001', 'x', 'ACTIVE', %NOW%)"],
    ['countries mixed-case code', "INSERT INTO countries (id, code, name, status, created_at, updated_at) VALUES (:id, 'Cnt-000001', 'x', 'ACTIVE', %NOW%)"],
    ['countries blank name', "INSERT INTO countries (id, code, name, status, created_at, updated_at) VALUES (:id, 'CNT-000001', '   ', 'ACTIVE', %NOW%)"],
    ['countries unknown status', "INSERT INTO countries (id, code, name, status, created_at, updated_at) VALUES (:id, 'CNT-000001', 'x', 'PENDING', %NOW%)"],
    ['countries code of another level', "INSERT INTO countries (id, code, name, status, created_at, updated_at) VALUES (:id, 'GOV-000001', 'x', 'ACTIVE', %NOW%)"],
  ])('CHECK rejects %s', async (_label, sql) => {
    await inRollback(async (tx) => {
      await expect(raw(tx, sql.replace('%NOW%', NOW), { id: ID(1) })).rejects.toThrow();
    });
  });

  it('CHECKs on the other levels: code case, kind and code prefix', async () => {
    await inRollback(async (tx) => {
      const country = await add(tx, 'COUNTRY', 'مصر', null);
      const gov = await add(tx, 'GOVERNORATE', 'الدقهلية', country.id);
      const center = await add(tx, 'CENTER', 'المنصورة', gov.id, 'CENTER');
      const insertGov = (code: string) => raw(tx, `INSERT INTO governorates (id, code, name, status, country_id, created_at, updated_at) VALUES (:id, :code, 'ز', 'ACTIVE', :parent, ${NOW})`, { id: ID(3), code, parent: country.id });
      const insertCenter = (code: string, kind: string) => raw(tx, `INSERT INTO centers (id, code, name, status, governorate_id, kind, created_at, updated_at) VALUES (:id, :code, 'ز', 'ACTIVE', :parent, :kind, ${NOW})`, { id: ID(4), code, kind, parent: gov.id });
      const insertVillage = (code: string) => raw(tx, `INSERT INTO villages (id, code, name, status, center_id, created_at, updated_at) VALUES (:id, :code, 'ز', 'ACTIVE', :parent, ${NOW})`, { id: ID(5), code, parent: center.id });
      await expect(insertGov('gov-000009')).rejects.toThrow();
      await expect(insertGov('CTR-000009')).rejects.toThrow();
      await expect(insertCenter('ctr-000009', 'CENTER')).rejects.toThrow();
      await expect(insertCenter('CTR-000009', 'TOWN')).rejects.toThrow();
      await expect(insertVillage('vil-000009')).rejects.toThrow();
      await expect(insertVillage('VIL-00000A')).rejects.toThrow();
      await expect(insertVillage('VIL-000009')).resolves.toBeDefined(); // a valid one still goes in
    });
  });
});
