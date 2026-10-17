import { describe, expect, it } from 'vitest';
import { AppError, type TransactionContext, type UnitOfWork } from '../../../src/modules/00-shared-kernel/public';
import { InMemoryOutboxStore, OutboxService } from '../../../src/modules/06-domain-events-outbox/public';
import { InMemoryOrganizationRepository, OrganizationService } from '../../../src/modules/13-organization-core/public';
import { GeographyNode, GeographyService, InMemoryGeographyRepository } from '../../../src/modules/14-geography/public';
import { UnifiedAddressService } from '../../../src/modules/15-unified-address/public';

const clock = { now: () => new Date('2026-10-11T10:00:00Z') };
const tx = {} as TransactionContext;
const unitOfWork: UnitOfWork = { run: (work) => work(tx) };
const codeOf = (p: Promise<unknown>) => p.then(() => 'NO_ERROR', (e: unknown) => (e instanceof AppError ? e.code : 'NOT_APP_ERROR'));
const detailsOf = (p: Promise<unknown>) => p.then(() => undefined, (e: unknown) => (e as AppError).details);

async function setup(options: { assignCountry?: boolean } = {}) {
  const geoRepo = new InMemoryGeographyRepository();
  const geography = new GeographyService(geoRepo);
  let n = 0;
  const add = async (level: 'COUNTRY' | 'GOVERNORATE', name: string, parentId: string | null) => {
    const node = GeographyNode.create({ level, name, parentId, code: `${level === 'COUNTRY' ? 'CNT' : 'GOV'}-${String(900000 + ++n)}`, clock });
    await geoRepo.insert(node, tx);
    return node;
  };
  const egypt = await add('COUNTRY', 'مصر', null);
  const france = await add('COUNTRY', 'France', null);
  const minya = await add('GOVERNORATE', 'المنيا', egypt.id);
  const asyut = await add('GOVERNORATE', 'أسيوط', egypt.id);
  const paris = await add('GOVERNORATE', 'Paris', france.id);
  const fayoum = await add('GOVERNORATE', 'Fayoum\u00e9', egypt.id); // composed (NFC) form, as stored names always are

  const orgRepo = new InMemoryOrganizationRepository();
  const organizations = new OrganizationService({ repository: orgRepo, unitOfWork, outbox: new OutboxService(new InMemoryOutboxStore(), clock), clock });
  const { organization: org } = await organizations.ensureMainOrganization('Al-Noor');
  if (options.assignCountry !== false) await organizations.assignMainOrganizationCountry(egypt.id);
  const service = new UnifiedAddressService({ geography, organizations });
  return { service, geoRepo, organizations, egypt, france, minya, asyut, paris, fayoum, org };
}

describe('UnifiedAddressService.validateParentAddress', () => {
  it('accepts a registered governorate with an UNREGISTERED center and village (free text), returning the governorate name snapshot', async () => {
    const s = await setup();
    const address = await s.service.validateParentAddress({ organizationId: s.org.id, governorateId: s.minya.id, centerName: 'سمالوط', villageName: 'قرية النور' });
    expect(address).toEqual({ governorateId: s.minya.id, governorateName: 'المنيا', centerName: 'سمالوط', villageName: 'قرية النور' });
  });

  it('stores missing optional parts as null: omitted, null and whitespace-only', async () => {
    const s = await setup();
    const empty = { governorateId: s.minya.id, governorateName: 'المنيا', centerName: null, villageName: null };
    expect(await s.service.validateParentAddress({ organizationId: s.org.id, governorateId: s.minya.id })).toEqual(empty);
    expect(await s.service.validateParentAddress({ organizationId: s.org.id, governorateId: s.minya.id, centerName: null, villageName: null })).toEqual(empty);
    expect(await s.service.validateParentAddress({ organizationId: s.org.id, governorateId: s.minya.id, centerName: '   ', villageName: '\t' })).toEqual(empty);
    expect((await s.service.validateParentAddress({ organizationId: s.org.id, governorateId: s.minya.id, centerName: ' سمالوط ', villageName: '  ' })).villageName).toBeNull();
  });

  it('normalizes the free text (NFC, whitespace) and enforces 200 characters', async () => {
    const s = await setup();
    const a = await s.service.validateParentAddress({ organizationId: s.org.id, governorateId: s.minya.id, centerName: '  سمالوط   مركز ', villageName: 'ق'.repeat(200) });
    expect(a.centerName).toBe('سمالوط مركز');
    expect(a.villageName).toHaveLength(200);
    expect(await codeOf(s.service.validateParentAddress({ organizationId: s.org.id, governorateId: s.minya.id, centerName: 'ق'.repeat(201) }))).toBe('INVALID_PARENT_ADDRESS');
  });

  it('rejects a village without a nonblank center', async () => {
    const s = await setup();
    for (const centerName of [undefined, null, '', '   ']) {
      const p = s.service.validateParentAddress({ organizationId: s.org.id, governorateId: s.minya.id, centerName, villageName: 'قرية النور' });
      expect(await detailsOf(p)).toEqual([{ field: 'village', code: 'INVALID_PARENT_ADDRESS' }]);
    }
  });

  it('rejects a missing, non-text or unknown governorate', async () => {
    const s = await setup();
    for (const governorateId of [undefined, null, '', '   ', 5]) {
      expect(await codeOf(s.service.validateParentAddress({ organizationId: s.org.id, governorateId }))).toBe('INVALID_PARENT_ADDRESS');
    }
    expect(await codeOf(s.service.validateParentAddress({ organizationId: s.org.id, governorateId: '11111111-1111-4111-8111-111111111111' }))).toBe('PARENT_ADDRESS_GOVERNORATE_NOT_FOUND');
    expect(await codeOf(s.service.validateParentAddress(undefined as never))).toBe('INVALID_PARENT_ADDRESS');
  });

  it('validates the governorate against the Main Organization country (never an input)', async () => {
    const s = await setup();
    expect(await codeOf(s.service.validateParentAddress({ organizationId: s.org.id, governorateId: s.paris.id }))).toBe('PARENT_ADDRESS_COUNTRY_MISMATCH');
    // a country entered by the caller is ignored: it cannot make a foreign governorate valid
    expect(await codeOf(s.service.validateParentAddress({ organizationId: s.org.id, governorateId: s.paris.id, countryId: s.france.id } as never))).toBe('PARENT_ADDRESS_COUNTRY_MISMATCH');
  });

  it('fails closed while the organization has no country, and without an organization', async () => {
    const s = await setup({ assignCountry: false });
    expect(await codeOf(s.service.validateParentAddress({ organizationId: s.org.id, governorateId: s.minya.id }))).toBe('ORGANIZATION_COUNTRY_NOT_SET');
    expect(await codeOf(s.service.validateRawParentAddress('المنيا', s.org.id))).toBe('ORGANIZATION_COUNTRY_NOT_SET');
  });

  it('rejects an inactive governorate for a new or changed address, but a stored address stays readable', async () => {
    const s = await setup();
    s.geoRepo.setStatus(s.minya.id, 'INACTIVE');
    expect(await codeOf(s.service.validateParentAddress({ organizationId: s.org.id, governorateId: s.minya.id }))).toBe('PARENT_ADDRESS_GOVERNORATE_INACTIVE');
    expect(await codeOf(s.service.validateRawParentAddress('المنيا / سمالوط', s.org.id))).toBe('PARENT_ADDRESS_GOVERNORATE_INACTIVE');
    const stored = { governorateId: s.minya.id, governorateName: 'المنيا', centerName: 'سمالوط', villageName: null };
    expect(await s.service.describeStoredParentAddress(stored)).toEqual(stored);
    expect((await s.service.describeStoredParentAddress({ governorateId: s.minya.id })).governorateName).toBe('المنيا');
  });
});

describe('UnifiedAddressService.validateRawParentAddress (same rules as structured input)', () => {
  it('accepts A, A/B and A/B/C with unregistered center and village', async () => {
    const s = await setup();
    expect(await s.service.validateRawParentAddress('المنيا', s.org.id)).toEqual({ governorateId: s.minya.id, governorateName: 'المنيا', centerName: null, villageName: null });
    expect(await s.service.validateRawParentAddress(' المنيا /  سمالوط ', s.org.id)).toMatchObject({ governorateId: s.minya.id, centerName: 'سمالوط', villageName: null });
    expect(await s.service.validateRawParentAddress('المنيا / سمالوط / قرية النور', s.org.id)).toEqual({
      governorateId: s.minya.id,
      governorateName: 'المنيا',
      centerName: 'سمالوط',
      villageName: 'قرية النور',
    });
  });

  it('matches the governorate name exactly: Arabic letter variants are NOT folded', async () => {
    const s = await setup();
    expect((await s.service.validateRawParentAddress('أسيوط', s.org.id)).governorateId).toBe(s.asyut.id);
    expect(await codeOf(s.service.validateRawParentAddress('اسيوط', s.org.id))).toBe('PARENT_ADDRESS_GOVERNORATE_NOT_FOUND');
    expect(await codeOf(s.service.validateRawParentAddress('المنيه', s.org.id))).toBe('PARENT_ADDRESS_GOVERNORATE_NOT_FOUND');
    expect(await codeOf(s.service.validateRawParentAddress('Minya', s.org.id))).toBe('PARENT_ADDRESS_GOVERNORATE_NOT_FOUND');
  });

  it('applies NFC before matching and matches only governorates of the organization country', async () => {
    const s = await setup();
    expect((await s.service.validateRawParentAddress('Fayoume\u0301 / x', s.org.id)).governorateId).toBe(s.fayoum.id); // decomposed input matches the composed stored name
    expect(await codeOf(s.service.validateRawParentAddress('Paris / x', s.org.id))).toBe('PARENT_ADDRESS_GOVERNORATE_NOT_FOUND'); // a French governorate is not in Egypt
  });

  it('rejects empty components and surplus parts exactly like the parser', async () => {
    const s = await setup();
    for (const bad of ['المنيا//قرية', 'المنيا/سمالوط/', '/المنيا', 'المنيا/a/b/c', '', '  ']) {
      expect(await codeOf(s.service.validateRawParentAddress(bad, s.org.id))).toBe('INVALID_PARENT_ADDRESS');
    }
  });
});

describe('UnifiedAddressService.describeStoredParentAddress', () => {
  it('uses the stored governorate-name snapshot as is, even after the governorate is renamed (no live lookup)', async () => {
    const s = await setup();
    const address = await s.service.validateParentAddress({ organizationId: s.org.id, governorateId: s.minya.id, centerName: 'سمالوط' });
    // The governorate is later renamed in Geography (no rename operation exists today; simulated at the repository).
    const row = s.geoRepo.rows.get(s.minya.id)!;
    s.geoRepo.rows.set(s.minya.id, { ...row, name: 'المنيا الجديدة' });
    expect((await s.service.describeStoredParentAddress({ ...address })).governorateName).toBe('المنيا'); // snapshot wins
    expect((await s.service.describeStoredParentAddress({ governorateId: s.minya.id })).governorateName).toBe('المنيا الجديدة'); // no snapshot: current name
  });

  it('fails for a stored address whose governorate no longer exists and has no snapshot', async () => {
    const s = await setup();
    expect(await codeOf(s.service.describeStoredParentAddress({ governorateId: '11111111-1111-4111-8111-111111111111' }))).toBe('PARENT_ADDRESS_GOVERNORATE_NOT_FOUND');
  });
});

describe('organization-based country (many organizations)', () => {
  it('uses the country of THAT organization: the same governorate is valid for one organization and refused for another', async () => {
    const s = await setup();
    const frenchOrg = await s.organizations.createOrganization({ name: 'École', countryId: s.france.id, governorateId: s.paris.id });
    expect(await s.service.validateParentAddress({ organizationId: frenchOrg.id, governorateId: s.paris.id })).toMatchObject({ governorateName: 'Paris' });
    expect(await codeOf(s.service.validateParentAddress({ organizationId: frenchOrg.id, governorateId: s.minya.id }))).toBe('PARENT_ADDRESS_COUNTRY_MISMATCH');
    expect(await codeOf(s.service.validateParentAddress({ organizationId: s.org.id, governorateId: s.paris.id }))).toBe('PARENT_ADDRESS_COUNTRY_MISMATCH');
    expect((await s.service.validateRawParentAddress('Paris', frenchOrg.id)).governorateId).toBe(s.paris.id);
    expect(await codeOf(s.service.validateRawParentAddress('Paris', s.org.id))).toBe('PARENT_ADDRESS_GOVERNORATE_NOT_FOUND'); // not a governorate of Egypt
  });

  it('fails for an unknown organization and for a missing organization id', async () => {
    const s = await setup();
    expect(await codeOf(s.service.validateParentAddress({ organizationId: 'no-such-org', governorateId: s.minya.id }))).toBe('ORGANIZATION_NOT_FOUND');
    expect(await codeOf(s.service.validateParentAddress({ organizationId: undefined, governorateId: s.minya.id }))).toBe('INVALID_PARENT_ADDRESS');
    expect(await codeOf(s.service.validateRawParentAddress('المنيا', ''))).toBe('INVALID_PARENT_ADDRESS');
  });
});

describe('UnifiedAddressService.validateOrganizationAddress (the organization\'s own address)', () => {
  it('accepts country + governorate, with optional FREE-TEXT center and village (normalized, never looked up)', async () => {
    const s = await setup();
    expect(await s.service.validateOrganizationAddress({ countryId: s.egypt.id, governorateId: s.minya.id })).toEqual({ countryId: s.egypt.id, governorateId: s.minya.id, centerName: null, villageName: null });
    expect(await s.service.validateOrganizationAddress({ countryId: s.egypt.id, governorateId: s.minya.id, centerName: '  مركز   غير   مسجل ', villageName: 'قرية لا وجود لها' })).toEqual({
      countryId: s.egypt.id,
      governorateId: s.minya.id,
      centerName: 'مركز غير مسجل',
      villageName: 'قرية لا وجود لها',
    });
  });

  it('requires country and governorate, and rejects a governorate of another country', async () => {
    const s = await setup();
    expect(await codeOf(s.service.validateOrganizationAddress({ countryId: undefined, governorateId: s.minya.id }))).toBe('INVALID_PARENT_ADDRESS');
    expect(await codeOf(s.service.validateOrganizationAddress({ countryId: s.egypt.id, governorateId: undefined }))).toBe('INVALID_PARENT_ADDRESS');
    expect(await codeOf(s.service.validateOrganizationAddress({ countryId: s.france.id, governorateId: s.minya.id }))).toBe('ORGANIZATION_ADDRESS_COUNTRY_MISMATCH');
    expect(await codeOf(s.service.validateOrganizationAddress({ countryId: s.egypt.id, governorateId: 'missing' }))).toBe('GEOGRAPHY_NODE_NOT_FOUND');
    expect(await codeOf(s.service.validateOrganizationAddress(undefined as never))).toBe('INVALID_PARENT_ADDRESS');
  });

  it('a village needs a center, text is limited to 200 characters, and an inactive governorate is refused', async () => {
    const s = await setup();
    expect(await codeOf(s.service.validateOrganizationAddress({ countryId: s.egypt.id, governorateId: s.minya.id, villageName: 'قرية' }))).toBe('INVALID_PARENT_ADDRESS');
    expect(await codeOf(s.service.validateOrganizationAddress({ countryId: s.egypt.id, governorateId: s.minya.id, centerName: 'x'.repeat(201) }))).toBe('INVALID_PARENT_ADDRESS');
    expect(await codeOf(s.service.validateOrganizationAddress({ countryId: s.egypt.id, governorateId: s.minya.id, centerName: 7 as never }))).toBe('INVALID_PARENT_ADDRESS');
    s.geoRepo.setStatus(s.minya.id, 'INACTIVE');
    expect(await codeOf(s.service.validateOrganizationAddress({ countryId: s.egypt.id, governorateId: s.minya.id }))).toBe('GEOGRAPHY_NODE_INACTIVE');
  });
});

describe('UnifiedAddressService.validateSchoolAddress (identical to the Parent rules; the country comes from the organization)', () => {
  it('delegates to the Parent Address contract: registered governorate, free-text center and village', async () => {
    const s = await setup();
    const input = { organizationId: s.org.id, governorateId: s.minya.id, centerName: 'مركز غير مسجل', villageName: 'قرية غير مسجلة' };
    expect(await s.service.validateSchoolAddress(input)).toEqual(await s.service.validateParentAddress(input));
  });
});
