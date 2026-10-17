/**
 * Real-database checks for Module 13 (Main Organization). Prerequisite: `npm run db:migrate`. Run: npm run test:db
 * Safe on any database: every test runs inside ONE outer transaction (nested services join it) that is ALWAYS rolled back,
 * so a real organization, if present, is never changed or deleted and nothing is left behind.
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
const makeService = () =>
  new OrganizationService({ repository, unitOfWork: uow, outbox: new OutboxService(new SequelizeOutboxStore(sequelize)) });

class Rollback extends Error {}
/** Runs `work` in a transaction on an EMPTY organizations table (inside the transaction only) and always rolls back. */
async function inRollback(work: (tx: TransactionContext, q: <T extends object>(sql: string, replacements?: Record<string, string>) => Promise<T[]>) => Promise<void>): Promise<void> {
  try {
    await uow.run(async (tx) => {
      const transaction = sequelizeTransactionOf(tx);
      const q = <T extends object>(sql: string, replacements: Record<string, string> = {}) =>
        sequelize.query<T>(sql, { replacements, type: QueryTypes.SELECT, transaction: transaction ?? null });
      // Module 16: schools reference organizations and geography (RESTRICT); clear them inside this rolled-back transaction first.
      for (const table of ['school_classification_archive', 'school_manager_source_archive', 'school_gps_history', 'school_status_history', 'school_managers']) await sequelize.query(`DELETE FROM ${table}`, { transaction: transaction ?? null });
      await sequelize.query('DELETE FROM schools', { transaction: transaction ?? null });
      await sequelize.query('DELETE FROM organization_admins', { transaction: transaction ?? null });
      await sequelize.query('DELETE FROM organizations', { transaction: transaction ?? null });
      const left = await q<{ n: number }>('SELECT COUNT(*) AS n FROM organizations');
      if (Number(left[0]?.n) !== 0) throw new Error('Test precondition failed: organizations is not empty inside the test transaction');
      await work(tx, q);
      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
}
const insertRaw = (tx: TransactionContext, id: string, code: string, name: string, status = 'ACTIVE', guard = 1) =>
  sequelize.query(
    `INSERT INTO organizations (id, code, name, status, v1_single_guard, created_at, updated_at)
     VALUES (:id, :code, :name, :status, :guard, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
    { replacements: { id, code, name, status, guard }, transaction: sequelizeTransactionOf(tx) ?? null },
  );
const ID1 = '11111111-1111-4111-8111-111111111111';
const ID2 = '22222222-2222-4222-8222-222222222222';

afterAll(async () => {
  await sequelize.close();
});

describe('organizations schema (migration)', () => {
  it('has the approved columns, unique code and unique NAME (the V1 single-organization guard is gone), and the geography foreign keys (country and governorate only: center and village are free text)', async () => {
    const columns = await sequelize.query<{ COLUMN_NAME: string }>(
      "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'organizations' ORDER BY ORDINAL_POSITION",
      { type: QueryTypes.SELECT },
    );
    expect(columns.map((c) => c.COLUMN_NAME)).toEqual(['id', 'code', 'name', 'status', 'country_id', 'governorate_id', 'center_name', 'village_name', 'v1_single_guard', 'created_at', 'updated_at']);

    const unique = await sequelize.query<{ INDEX_NAME: string }>(
      "SELECT DISTINCT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'organizations' AND NON_UNIQUE = 0",
      { type: QueryTypes.SELECT },
    );
    expect(unique.map((i) => i.INDEX_NAME).sort()).toEqual(['PRIMARY', 'uq_organizations_code', 'uq_organizations_id_country', 'uq_organizations_name']);

    const fks = await sequelize.query<{ COLUMN_NAME: string; REFERENCED_TABLE_NAME: string }>(
      "SELECT COLUMN_NAME, REFERENCED_TABLE_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'organizations' AND REFERENCED_TABLE_NAME IS NOT NULL",
      { type: QueryTypes.SELECT },
    );
    expect(fks.map((f) => `${f.COLUMN_NAME}>${f.REFERENCED_TABLE_NAME}`).sort()).toEqual(['country_id>countries', 'governorate_id>governorates']);

    const [name] = await sequelize.query<{ CHARACTER_SET_NAME: string }>(
      "SELECT CHARACTER_SET_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'organizations' AND COLUMN_NAME = 'name'",
      { type: QueryTypes.SELECT },
    );
    expect(name?.CHARACTER_SET_NAME).toBe('utf8mb4');
  });
});

describe('OrganizationService (MariaDB)', () => {
  it('stores Arabic and English names exactly (utf8mb4) and reads them back', async () => {
    await inRollback(async (tx) => {
      const service = makeService();
      const { organization } = await service.ensureMainOrganization('مؤسسة النور لتحفيظ القرآن الكريم - Al-Noor 🌙', tx);
      expect(organization.code).toMatch(/^ORG-\d{6}$/);
      // Reads use the same transaction: the row is not committed, so another connection could not see it.
      expect((await service.getMainOrganization(tx))?.name).toBe('مؤسسة النور لتحفيظ القرآن الكريم - Al-Noor 🌙');
      expect((await service.findById(organization.id, tx))?.status).toBe('ACTIVE');
    });
  });

  it('persists the organization and its OrganizationCreated event together, and is idempotent (one row, one event)', async () => {
    await inRollback(async (tx, q) => {
      const service = makeService();
      const first = await service.ensureMainOrganization('Al-Noor', tx);
      const again = await service.ensureMainOrganization('Other name', tx);
      expect(first.created).toBe(true);
      expect(again).toMatchObject({ created: false, organization: { id: first.organization.id, name: 'Al-Noor' } });
      expect(await q('SELECT id FROM organizations')).toHaveLength(1);
      const events = await q<{ event_type: string; payload: string }>(
        "SELECT event_type, payload FROM outbox_messages WHERE aggregate_type = 'Organization' AND aggregate_id = :id",
        { id: first.organization.id },
      );
      expect(events).toHaveLength(1);
      expect(events[0]?.event_type).toBe('OrganizationCreated');
      expect(JSON.parse(events[0]!.payload)).toEqual({ organizationId: first.organization.id, code: first.organization.code });
    });
  });

  it('rolls back the organization AND its event when the surrounding transaction fails', async () => {
    const before = await sequelize.query<{ n: number }>("SELECT COUNT(*) AS n FROM outbox_messages WHERE aggregate_type = 'Organization'", { type: QueryTypes.SELECT });
    const orgsBefore = await sequelize.query<{ n: number }>('SELECT COUNT(*) AS n FROM organizations', { type: QueryTypes.SELECT });
    await expect(
      uow.run(async (tx) => {
        // Module 16: schools reference organizations and geography (RESTRICT); clear them inside this rolled-back transaction first.
        for (const table of ['school_classification_archive', 'school_manager_source_archive', 'school_gps_history', 'school_status_history', 'school_managers']) await sequelize.query(`DELETE FROM ${table}`, { transaction: sequelizeTransactionOf(tx) ?? null });
        await sequelize.query('DELETE FROM schools', { transaction: sequelizeTransactionOf(tx) ?? null });
        await sequelize.query('DELETE FROM organization_admins', { transaction: sequelizeTransactionOf(tx) ?? null });
        await sequelize.query('DELETE FROM organizations', { transaction: sequelizeTransactionOf(tx) ?? null });
        await makeService().ensureMainOrganization('Will be rolled back', tx);
        throw new Error('later step failed');
      }),
    ).rejects.toThrow('later step failed');
    const after = await sequelize.query<{ n: number }>("SELECT COUNT(*) AS n FROM outbox_messages WHERE aggregate_type = 'Organization'", { type: QueryTypes.SELECT });
    const orgsAfter = await sequelize.query<{ n: number }>('SELECT COUNT(*) AS n FROM organizations', { type: QueryTypes.SELECT });
    expect(Number(after[0]!.n)).toBe(Number(before[0]!.n));
    expect(Number(orgsAfter[0]!.n)).toBe(Number(orgsBefore[0]!.n));
  });

  it('answers a creation race with the existing row: the unique name rejects the insert, no duplicate, no extra event', async () => {
    await inRollback(async (tx, q) => {
      const winner = await makeService().ensureMainOrganization('Winner', tx);
      // The service's first look is made to miss the row (as if another process committed in between); the insert must hit the unique guard.
      const realFindMain = repository.findMain.bind(repository);
      let first = true;
      const racing = new OrganizationService({
        repository: Object.assign(Object.create(repository), {
          findMain: async (t?: TransactionContext) => (first ? ((first = false), undefined) : realFindMain(t)),
        }),
        unitOfWork: uow,
        outbox: new OutboxService(new SequelizeOutboxStore(sequelize)),
      });
      const loser = await racing.ensureMainOrganization('winner', tx); // same name (case-insensitive): the unique NAME is what the loser hits
      expect(loser).toMatchObject({ created: false, organization: { id: winner.organization.id } });
      expect(await q('SELECT id FROM organizations')).toHaveLength(1);
      expect(await q("SELECT id FROM outbox_messages WHERE aggregate_type = 'Organization' AND aggregate_id = :id", { id: winner.organization.id })).toHaveLength(1);
    });
  });
});

describe('database guards', () => {
  it('allows many organizations (the V1 single-organization guard was removed)', async () => {
    await inRollback(async (tx, q) => {
      await insertRaw(tx, ID1, 'ORG-000001', 'First');
      await insertRaw(tx, ID2, 'ORG-000002', 'Second');
      expect(await q('SELECT id FROM organizations')).toHaveLength(2);
    });
  });

  it('rejects a duplicate code and a duplicate NAME across the whole system (case-insensitive)', async () => {
    await inRollback(async (tx) => {
      await insertRaw(tx, ID1, 'ORG-000001', 'Dar Al-Quran');
      await expect(insertRaw(tx, ID2, 'ORG-000001', 'Second')).rejects.toThrow();
      await expect(insertRaw(tx, ID2, 'ORG-000002', 'dar al-quran')).rejects.toThrow();
      await expect(insertRaw(tx, ID2, 'ORG-000002', 'DAR AL-QURAN')).rejects.toThrow();
    });
  });

  it.each([
    ['bad code format', 'ORG-1', 'Name', 'ACTIVE'],
    ['lowercase code', 'org-000001', 'Name', 'ACTIVE'],
    ['mixed-case code', 'Org-000001', 'Name', 'ACTIVE'],
    ['non-digit suffix', 'ORG-00000A', 'Name', 'ACTIVE'],
    ['blank name', 'ORG-000001', '   ', 'ACTIVE'],
    ['unknown status', 'ORG-000001', 'Name', 'PENDING'],
  ])('rejects %s', async (_label, code, name, status) => {
    await inRollback(async (tx) => {
      await expect(insertRaw(tx, ID1, code, name, status)).rejects.toThrow();
    });
  });

  it('maps the unique-index violations to ORGANIZATION_NAME_ALREADY_EXISTS (name) and ORGANIZATION_ALREADY_EXISTS (code) in the repository', async () => {
    await inRollback(async (tx) => {
      const service = makeService();
      const { organization } = await service.ensureMainOrganization('First', tx);
      const { Organization } = await import('../../src/modules/13-organization-core/domain/entities/organization');
      const clock = { now: () => organization.createdAt };
      const sameName = await repository.insert(Organization.create({ name: 'FIRST', code: 'ORG-900002', clock }), tx).catch((e: unknown) => e);
      expect((sameName as AppError).code).toBe('ORGANIZATION_NAME_ALREADY_EXISTS');
      const sameCode = await repository.insert(Organization.create({ name: 'Second', code: organization.code, clock }), tx).catch((e: unknown) => e);
      expect((sameCode as AppError).code).toBe('ORGANIZATION_ALREADY_EXISTS');
    });
  });
});
