import { describe, expect, it } from 'vitest';
import { AppError, type Clock, type TransactionContext, type UnitOfWork } from '../../../src/modules/00-shared-kernel/public';
import {
  EGYPT_GOVERNORATE_NAMES,
  GeographyNode,
  GeographyService,
  InMemoryGeographyRepository,
  SeedEgyptGeography,
  type CenterKind,
  type GeographyLevel,
} from '../../../src/modules/14-geography/public';

const clock: Clock = { now: () => new Date('2026-10-10T10:00:00Z') };
const tx = {} as TransactionContext;
const unitOfWork: UnitOfWork = { run: (work) => work(tx) };
const codeOf = (p: Promise<unknown>) => p.then(() => 'NO_ERROR', (e: unknown) => (e instanceof AppError ? e.code : 'NOT_APP_ERROR'));

function setup() {
  const repository = new InMemoryGeographyRepository();
  const service = new GeographyService(repository);
  const seeder = new SeedEgyptGeography({ repository, unitOfWork, clock });
  let n = 0;
  const add = async (level: GeographyLevel, name: string, parentId: string | null, kind?: CenterKind) => {
    const prefix = { COUNTRY: 'CNT', GOVERNORATE: 'GOV', CENTER: 'CTR', VILLAGE: 'VIL' }[level];
    const node = GeographyNode.create({ level, name, parentId, kind, code: `${prefix}-${String(900000 + ++n)}`, clock });
    await repository.insert(node, tx);
    return node;
  };
  return { repository, service, seeder, add };
}

/** Two governorates, one center in the first, one village in that center, a second center elsewhere. */
async function tree() {
  const s = setup();
  const country = await s.add('COUNTRY', 'مصر', null);
  const gov = await s.add('GOVERNORATE', 'الدقهلية', country.id);
  const gov2 = await s.add('GOVERNORATE', 'الغربية', country.id);
  const center = await s.add('CENTER', 'المنصورة', gov.id, 'CENTER');
  const city = await s.add('CENTER', 'المنصورة', gov.id, 'CITY'); // same name, other kind: allowed
  const center2 = await s.add('CENTER', 'طنطا', gov2.id, 'CITY');
  const village = await s.add('VILLAGE', 'ميت غمر', center.id);
  return { ...s, country, gov, gov2, center, city, center2, village };
}

describe('SeedEgyptGeography', () => {
  it('creates Egypt and its 27 governorates with stable codes, and nothing else', async () => {
    const { seeder, service, repository } = setup();
    const summary = await seeder.execute();
    expect(summary).toEqual({ country: { code: 'CNT-000001', created: true }, governorates: { total: 27, created: 27, existing: 0 } });
    const [egypt] = await service.listCountries();
    const governorates = await service.listGovernorates(egypt!.id);
    expect(governorates.map((g) => g.name)).toEqual([...EGYPT_GOVERNORATE_NAMES]);
    expect(governorates[0]!.code).toBe('GOV-000001');
    expect(governorates[26]!.code).toBe('GOV-000027');
    expect([...repository.rows.values()].filter((r) => r.level === 'CENTER' || r.level === 'VILLAGE')).toHaveLength(0);
  });

  it('is idempotent: re-running changes nothing and creates no duplicates', async () => {
    const { seeder, repository } = setup();
    await seeder.execute();
    const before = [...repository.rows.values()].map((r) => r.id).sort();
    const again = await seeder.execute();
    expect(again).toEqual({ country: { code: 'CNT-000001', created: false }, governorates: { total: 27, created: 0, existing: 27 } });
    expect([...repository.rows.values()].map((r) => r.id).sort()).toEqual(before);
  });

  it('completes a partial seed without touching existing nodes', async () => {
    const { seeder, service, add } = setup();
    const country = await add('COUNTRY', 'مصر', null);
    const existing = await add('GOVERNORATE', 'القاهرة', country.id);
    const summary = await seeder.execute();
    expect(summary.country.created).toBe(false);
    expect(summary.governorates).toMatchObject({ created: 26, existing: 1 });
    expect((await service.getGovernorate(existing.id))?.code).toBe(existing.code);
  });
});

describe('GeographyService lookups', () => {
  it('gets nodes by level and returns undefined for unknown, wrong-level or empty ids', async () => {
    const t = await tree();
    expect(await t.service.getGovernorate(t.gov.id)).toMatchObject({ level: 'GOVERNORATE', name: 'الدقهلية', parentId: t.country.id, kind: null });
    expect(await t.service.getCenter(t.center.id)).toMatchObject({ kind: 'CENTER' });
    expect(await t.service.getCenter(t.city.id)).toMatchObject({ kind: 'CITY' });
    expect(await t.service.getVillage(t.village.id)).toMatchObject({ parentId: t.center.id });
    expect(await t.service.getCountry(t.country.id)).toMatchObject({ parentId: null });
    expect(await t.service.getVillage(t.gov.id)).toBeUndefined(); // wrong level
    expect(await t.service.getGovernorate('missing')).toBeUndefined();
    expect(await t.service.getGovernorate('')).toBeUndefined();
  });

  it('lists children under their parent only', async () => {
    const t = await tree();
    expect((await t.service.listGovernorates(t.country.id)).map((n) => n.id)).toEqual([t.gov.id, t.gov2.id]);
    expect((await t.service.listCenters(t.gov.id)).map((n) => n.id).sort()).toEqual([t.center.id, t.city.id].sort());
    expect((await t.service.listVillages(t.center.id)).map((n) => n.id)).toEqual([t.village.id]);
    expect(await t.service.listVillages(t.city.id)).toEqual([]);
    expect(await t.service.listCenters('')).toEqual([]);
  });
});

describe('GeographyService.validateHierarchy', () => {
  it('accepts a governorate alone, governorate + center, and the full chain, returning the resolved chain', async () => {
    const t = await tree();
    const onlyGov = await t.service.validateHierarchy({ governorateId: t.gov.id });
    expect(onlyGov).toMatchObject({ country: { id: t.country.id }, governorate: { id: t.gov.id }, center: null, village: null });
    const withCenter = await t.service.validateHierarchy({ governorateId: t.gov.id, centerId: t.center.id, villageId: null });
    expect(withCenter.center?.id).toBe(t.center.id);
    const full = await t.service.validateHierarchy({ governorateId: t.gov.id, centerId: t.center.id, villageId: t.village.id });
    expect(full.village?.id).toBe(t.village.id);
  });

  it('requires the governorate', async () => {
    const t = await tree();
    for (const input of [{}, { governorateId: '' }, { governorateId: undefined, centerId: t.center.id }, null]) {
      expect(await codeOf(t.service.validateHierarchy(input as never))).toBe('INVALID_GEOGRAPHY_HIERARCHY');
    }
  });

  it('a village cannot exist without its center', async () => {
    const t = await tree();
    expect(await codeOf(t.service.validateHierarchy({ governorateId: t.gov.id, villageId: t.village.id }))).toBe('INVALID_GEOGRAPHY_HIERARCHY');
    expect(await codeOf(t.service.validateHierarchy({ governorateId: t.gov.id, centerId: null, villageId: t.village.id }))).toBe('INVALID_GEOGRAPHY_HIERARCHY');
  });

  it('rejects a center outside the governorate and a village outside the center', async () => {
    const t = await tree();
    expect(await codeOf(t.service.validateHierarchy({ governorateId: t.gov.id, centerId: t.center2.id }))).toBe('INVALID_GEOGRAPHY_HIERARCHY');
    expect(await codeOf(t.service.validateHierarchy({ governorateId: t.gov.id, centerId: t.city.id, villageId: t.village.id }))).toBe('INVALID_GEOGRAPHY_HIERARCHY');
    expect(await codeOf(t.service.validateHierarchy({ governorateId: t.gov2.id, centerId: t.center.id }))).toBe('INVALID_GEOGRAPHY_HIERARCHY');
  });

  it('rejects unknown ids, wrong-level ids and blank optional ids', async () => {
    const t = await tree();
    expect(await codeOf(t.service.validateHierarchy({ governorateId: 'nope' }))).toBe('GEOGRAPHY_NODE_NOT_FOUND');
    expect(await codeOf(t.service.validateHierarchy({ governorateId: t.country.id }))).toBe('GEOGRAPHY_NODE_NOT_FOUND'); // a country is not a governorate
    expect(await codeOf(t.service.validateHierarchy({ governorateId: t.gov.id, centerId: 'nope' }))).toBe('GEOGRAPHY_NODE_NOT_FOUND');
    expect(await codeOf(t.service.validateHierarchy({ governorateId: t.gov.id, centerId: t.center.id, villageId: 'nope' }))).toBe('GEOGRAPHY_NODE_NOT_FOUND');
    expect(await codeOf(t.service.validateHierarchy({ governorateId: t.gov.id, centerId: '' }))).toBe('INVALID_GEOGRAPHY_HIERARCHY');
  });

  it('rejects inactive nodes by default and accepts them with requireActive: false', async () => {
    const t = await tree();
    t.repository.setStatus(t.village.id, 'INACTIVE');
    const input = { governorateId: t.gov.id, centerId: t.center.id, villageId: t.village.id };
    expect(await codeOf(t.service.validateHierarchy(input))).toBe('GEOGRAPHY_NODE_INACTIVE');
    expect((await t.service.validateHierarchy(input, { requireActive: false })).village?.status).toBe('INACTIVE');
    t.repository.setStatus(t.country.id, 'INACTIVE');
    expect(await codeOf(t.service.validateHierarchy({ governorateId: t.gov.id }))).toBe('GEOGRAPHY_NODE_INACTIVE');
  });
});

describe('in-memory repository mirrors the database rules', () => {
  it('rejects a duplicate name under the same parent (kind-aware), a duplicate code and a missing parent', async () => {
    const t = await tree();
    expect(await codeOf(t.add('CENTER', 'المنصورة', t.gov.id, 'CENTER'))).toBe('GEOGRAPHY_NODE_ALREADY_EXISTS');
    expect(await codeOf(t.add('GOVERNORATE', 'الدقهلية', t.country.id))).toBe('GEOGRAPHY_NODE_ALREADY_EXISTS');
    expect(await codeOf(t.add('GOVERNORATE', 'الدقهلية', t.country.id))).toBe('GEOGRAPHY_NODE_ALREADY_EXISTS');
    expect(await codeOf(t.add('VILLAGE', 'قرية', 'no-such-center'))).toBe('GEOGRAPHY_PARENT_NOT_FOUND');
    expect(await codeOf(t.add('VILLAGE', 'قرية', t.gov.id))).toBe('GEOGRAPHY_PARENT_NOT_FOUND'); // parent of the wrong level
    expect(await codeOf(t.add('VILLAGE', 'ميت غمر', t.city.id))).toBe('NO_ERROR'); // same name under another center is fine
  });
});
