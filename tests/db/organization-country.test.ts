/**
 * Real-database checks for the Main Organization country (Module 13, groundwork for Module 15).
 * Prerequisite: `npm run db:migrate`. Run: npm run test:db
 * Safe on any database: every test runs in ONE outer transaction that is ALWAYS rolled back (countries and the
 * organization used here are created inside it), so existing data is never changed and nothing is left behind.
 */
import { QueryTypes } from 'sequelize';
import { afterAll, describe, expect, it } from 'vitest';
import { env } from '../../src/config/env';
import { AppError, type TransactionContext } from '../../src/modules/00-shared-kernel/public';
import { SequelizeUnitOfWork, createSequelize, sequelizeTransactionOf } from '../../src/modules/02-database/public';
import { OutboxService, SequelizeOutboxStore } from '../../src/modules/06-domain-events-outbox/public';
import { OrganizationService, SequelizeOrganizationRepository } from '../../src/modules/13-organization-core/public';

const sequelize = createSequelize(env.database);
const uow = new SequelizeUnitOfWork(sequelize);
const repository = new SequelizeOrganizationRepository(sequelize);
const makeService = () => new OrganizationService({ repository, unitOfWork: uow, outbox: new OutboxService(new SequelizeOutboxStore(sequelize)) });

class Rollback extends Error {}
type Query = <T extends object>(sql: string, replacements?: Record<string, string>) => Promise<T[]>;
async function inRollback(work: (tx: TransactionContext, q: Query) => Promise<void>): Promise<void> {
  try {
    await uow.run(async (tx) => {
      const transaction = sequelizeTransactionOf(tx);
      const q: Query = (sql, replacements = {}) => sequelize.query(sql, { replacements, type: QueryTypes.SELECT, transaction: transaction ?? null });
      // Module 16: schools reference organizations and geography (RESTRICT); clear them inside this rolled-back transaction first.
      for (const table of ['school_gps_history', 'school_status_history', 'school_managers']) await sequelize.query(`DELETE FROM ${table}`, { transaction: transaction ?? null });
      await sequelize.query('DELETE FROM schools WHERE parent_school_id IS NOT NULL', { transaction: transaction ?? null });
      await sequelize.query('DELETE FROM schools', { transaction: transaction ?? null });
      await sequelize.query('DELETE FROM organization_admins', { transaction: transaction ?? null });
      await sequelize.query('DELETE FROM organizations', { transaction: transaction ?? null });
      await work(tx, q);
      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
}
const addCountry = (tx: TransactionContext, id: string, code: string, name: string) =>
  sequelize.query(
    'INSERT INTO countries (id, code, name, status, created_at, updated_at) VALUES (:id, :code, :name, \'ACTIVE\', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))',
    { replacements: { id, code, name }, transaction: sequelizeTransactionOf(tx) ?? null },
  );
const codeOf = (p: Promise<unknown>) => p.then(() => 'NO_ERROR', (e: unknown) => (e instanceof AppError ? e.code : 'NOT_APP_ERROR'));
const C1 = '91111111-1111-4111-8111-111111111111';
const C2 = '92222222-2222-4222-8222-222222222222';

afterAll(async () => {
  await sequelize.close();
});

describe('organizations.country_id (migration add-organizations-country)', () => {
  it('is a nullable CHAR(36) with the same type as countries.id and a RESTRICT foreign key to countries.id', async () => {
    const col = (table: string, column: string) =>
      sequelize.query<{ COLUMN_TYPE: string; IS_NULLABLE: string; CHARACTER_SET_NAME: string; COLLATION_NAME: string }>(
        'SELECT COLUMN_TYPE, IS_NULLABLE, CHARACTER_SET_NAME, COLLATION_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :table AND COLUMN_NAME = :column',
        { replacements: { table, column }, type: QueryTypes.SELECT },
      );
    const [country] = await col('organizations', 'country_id');
    const [countryId] = await col('countries', 'id');
    expect(country?.IS_NULLABLE).toBe('YES');
    expect(country).toMatchObject({ COLUMN_TYPE: countryId?.COLUMN_TYPE, CHARACTER_SET_NAME: countryId?.CHARACTER_SET_NAME, COLLATION_NAME: countryId?.COLLATION_NAME });
    expect(country?.COLUMN_TYPE).toBe('char(36)');

    const fks = await sequelize.query<{ CONSTRAINT_NAME: string; REFERENCED_TABLE_NAME: string; REFERENCED_COLUMN_NAME: string; DELETE_RULE: string; UPDATE_RULE: string }>(
      `SELECT k.CONSTRAINT_NAME, k.REFERENCED_TABLE_NAME, k.REFERENCED_COLUMN_NAME, r.DELETE_RULE, r.UPDATE_RULE
         FROM information_schema.KEY_COLUMN_USAGE k
         JOIN information_schema.REFERENTIAL_CONSTRAINTS r ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
        WHERE k.TABLE_SCHEMA = DATABASE() AND k.TABLE_NAME = 'organizations' AND k.COLUMN_NAME = 'country_id'`,
      { type: QueryTypes.SELECT },
    );
    expect(fks).toEqual([
      { CONSTRAINT_NAME: 'fk_organizations_country', REFERENCED_TABLE_NAME: 'countries', REFERENCED_COLUMN_NAME: 'id', DELETE_RULE: 'RESTRICT', UPDATE_RULE: 'RESTRICT' },
    ]);
  });
});

describe('OrganizationService.assignMainOrganizationCountry (MariaDB)', () => {
  it('stores the countries PRIMARY KEY (not the code), writes one OrganizationCountryAssigned event and is idempotent', async () => {
    await inRollback(async (tx, q) => {
      await addCountry(tx, C1, 'CNT-990001', 'دولة اختبار');
      const service = makeService();
      const { organization } = await service.ensureMainOrganization('Al-Noor', tx);
      const first = await service.assignMainOrganizationCountry(C1, tx);
      const again = await service.assignMainOrganizationCountry(C1, tx);
      expect(first.changed).toBe(true);
      expect(again.changed).toBe(false);
      const [row] = await q<{ country_id: string }>('SELECT country_id FROM organizations WHERE id = :id', { id: organization.id });
      expect(row?.country_id).toBe(C1);
      const joined = await q<{ code: string }>('SELECT c.code FROM organizations o JOIN countries c ON c.id = o.country_id WHERE o.id = :id', { id: organization.id });
      expect(joined).toEqual([{ code: 'CNT-990001' }]);
      const events = await q<{ payload: string }>(
        "SELECT payload FROM outbox_messages WHERE aggregate_type = 'Organization' AND event_type = 'OrganizationCountryAssigned' AND aggregate_id = :id",
        { id: organization.id },
      );
      expect(events).toHaveLength(1);
      expect(JSON.parse(events[0]!.payload)).toEqual({ organizationId: organization.id, countryId: C1 });
      expect((await service.requireMainOrganizationCountryId(tx))).toBe(C1);
    });
  });

  it('rejects a different country (immutable) and leaves the stored country and its event untouched', async () => {
    await inRollback(async (tx, q) => {
      await addCountry(tx, C1, 'CNT-990001', 'دولة اختبار');
      await addCountry(tx, C2, 'CNT-990002', 'Second test country');
      const service = makeService();
      await service.ensureMainOrganization('Al-Noor', tx);
      await service.assignMainOrganizationCountry(C1, tx);
      expect(await codeOf(service.assignMainOrganizationCountry(C2, tx))).toBe('ORGANIZATION_COUNTRY_ALREADY_SET');
      expect((await q<{ country_id: string }>('SELECT country_id FROM organizations'))[0]?.country_id).toBe(C1);
      expect(await q("SELECT 1 FROM outbox_messages WHERE event_type = 'OrganizationCountryAssigned' AND payload LIKE :p", { p: `%${C2}%` })).toHaveLength(0);
    });
  });

  it('the set-once UPDATE (WHERE country_id IS NULL) cannot overwrite an assigned country', async () => {
    await inRollback(async (tx, q) => {
      await addCountry(tx, C1, 'CNT-990001', 'دولة اختبار');
      await addCountry(tx, C2, 'CNT-990002', 'Second test country');
      const service = makeService();
      const { organization } = await service.ensureMainOrganization('Al-Noor', tx);
      await service.assignMainOrganizationCountry(C1, tx);
      expect(await repository.assignCountryIfUnset(organization.id, C2, new Date(), tx)).toBe(false);
      expect((await q<{ country_id: string }>('SELECT country_id FROM organizations'))[0]?.country_id).toBe(C1);
    });
  });

  it('rejects a country code and a nonexistent country id (foreign key), never storing either', async () => {
    await inRollback(async (tx, q) => {
      const service = makeService();
      await service.ensureMainOrganization('Al-Noor', tx);
      expect(await codeOf(service.assignMainOrganizationCountry('CNT-000001', tx))).toBe('ORGANIZATION_COUNTRY_INVALID');
      // A well-formed UUID that is no countries row: rejected by the foreign key, mapped to the same code.
      // A savepoint keeps the outer transaction usable after the failed statement.
      await sequelize.query('SAVEPOINT before_fk', { transaction: sequelizeTransactionOf(tx) ?? null });
      expect(await codeOf(service.assignMainOrganizationCountry('93333333-3333-4333-8333-333333333333', tx))).toBe('ORGANIZATION_COUNTRY_INVALID');
      await sequelize.query('ROLLBACK TO SAVEPOINT before_fk', { transaction: sequelizeTransactionOf(tx) ?? null });
      expect((await q<{ country_id: string | null }>('SELECT country_id FROM organizations'))[0]?.country_id).toBeNull();
    });
  });

  it('requireMainOrganizationCountryId fails closed while the country is not set', async () => {
    await inRollback(async (tx) => {
      const service = makeService();
      await service.ensureMainOrganization('Al-Noor', tx);
      expect(await codeOf(service.requireMainOrganizationCountryId(tx))).toBe('ORGANIZATION_COUNTRY_NOT_SET');
    });
  });

  it('a country that an organization uses cannot be deleted (RESTRICT)', async () => {
    await inRollback(async (tx) => {
      await addCountry(tx, C1, 'CNT-990001', 'دولة اختبار');
      const service = makeService();
      await service.ensureMainOrganization('Al-Noor', tx);
      await service.assignMainOrganizationCountry(C1, tx);
      await sequelize.query('SAVEPOINT before_delete', { transaction: sequelizeTransactionOf(tx) ?? null });
      await expect(sequelize.query('DELETE FROM countries WHERE id = :id', { replacements: { id: C1 }, transaction: sequelizeTransactionOf(tx) ?? null })).rejects.toThrow();
      await sequelize.query('ROLLBACK TO SAVEPOINT before_delete', { transaction: sequelizeTransactionOf(tx) ?? null });
    });
  });
});
