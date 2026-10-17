import { describe, expect, it } from 'vitest';
import { codeOf, createSchoolsHarness } from '../../helpers/schools-harness';

const COUNTRY = '22222222-2222-4222-8222-222222222222';

describe('OrganizationService.createOrganization (many organizations)', () => {
  it('creates an ACTIVE organization with a required country and its own address, independent of any school', async () => {
    const t = await createSchoolsHarness();
    const created = await t.organizations.createOrganization({ name: '  Dar   Al-Quran ', countryId: t.country.id, governorateId: t.gov.id, centerName: 'مركز', villageName: 'قرية' });
    expect(created).toMatchObject({ name: 'Dar Al-Quran', status: 'ACTIVE', countryId: t.country.id, governorateId: t.gov.id, centerName: 'مركز', villageName: 'قرية' });
    expect(created.code).toMatch(/^ORG-\d{6}$/);
    expect(created.code).not.toBe(t.org.code);
    expect(t.schools.rows.size).toBe(0); // no placeholder main school was created
    expect(t.events()).toContain('OrganizationCreated');
  });

  it('requires name, country and a valid address; a village needs a center', async () => {
    const t = await createSchoolsHarness();
    const base = { name: 'X', countryId: t.country.id, governorateId: t.gov.id };
    expect(await codeOf(t.organizations.createOrganization({ ...base, name: '   ' }))).toBe('INVALID_ORGANIZATION_NAME');
    expect(await codeOf(t.organizations.createOrganization({ ...base, name: 'y'.repeat(201) }))).toBe('INVALID_ORGANIZATION_NAME');
    expect(await codeOf(t.organizations.createOrganization({ ...base, countryId: undefined }))).toBe('ORGANIZATION_COUNTRY_INVALID');
    expect(await codeOf(t.organizations.createOrganization({ ...base, countryId: 'ORG-1' }))).toBe('ORGANIZATION_COUNTRY_INVALID');
    expect(await codeOf(t.organizations.createOrganization({ ...base, governorateId: undefined }))).toBe('INVALID_ORGANIZATION_ADDRESS');
    expect(await codeOf(t.organizations.createOrganization({ ...base, governorateId: 'nope' }))).toBe('INVALID_ORGANIZATION_ADDRESS');
    expect(await codeOf(t.organizations.createOrganization({ ...base, villageName: 'قرية' }))).toBe('INVALID_ORGANIZATION_ADDRESS'); // a village needs a center
    expect(t.orgRepo.rows.size).toBe(1); // only the harness organization
  });

  it('the name is unique across the whole system (case-insensitive, NFC), whatever the country', async () => {
    const t = await createSchoolsHarness();
    await t.organizations.createOrganization({ name: 'Dar Al-Quran', countryId: t.country.id, governorateId: t.gov.id });
    expect(await codeOf(t.organizations.createOrganization({ name: 'dar  al-quran', countryId: t.country.id, governorateId: t.gov.id }))).toBe('ORGANIZATION_NAME_ALREADY_EXISTS');
    expect(await codeOf(t.organizations.createOrganization({ name: 'DAR AL-QURAN', countryId: t.france.id, governorateId: t.paris.id }))).toBe('ORGANIZATION_NAME_ALREADY_EXISTS'); // not merely per country
    expect(t.orgRepo.rows.size).toBe(2);
  });

  it('allocates distinct codes for concurrent creations', async () => {
    const t = await createSchoolsHarness({ rollback: false });
    const results = await Promise.all(['A', 'B', 'C', 'D'].map((name) => t.organizations.createOrganization({ name, countryId: t.country.id, governorateId: t.gov.id })));
    expect(new Set(results.map((r) => r.code)).size).toBe(4);
  });

  it('the country stays immutable: a different country is refused', async () => {
    const t = await createSchoolsHarness();
    expect(await codeOf(t.organizations.assignMainOrganizationCountry(t.france.id))).toBe('ORGANIZATION_COUNTRY_ALREADY_SET');
    expect((await t.organizations.requireById(t.org.id)).countryId).toBe(t.country.id);
  });

  it('requireById and requireOrganizationCountryId fail for an unknown organization', async () => {
    const t = await createSchoolsHarness();
    expect(await codeOf(t.organizations.requireById(COUNTRY))).toBe('ORGANIZATION_NOT_FOUND');
    expect(await t.organizations.requireOrganizationCountryId(t.org.id)).toBe(t.country.id);
  });
});

describe('organization manager links (organization scope of ORGANIZATION_MANAGER)', () => {
  it('links a user to one organization only, idempotently, with history fields and one event', async () => {
    const t = await createSchoolsHarness();
    const other = await t.newOrganization('Other');
    const user = await t.newUser('ORGANIZATION_MANAGER');
    const first = await t.organizations.assignOrganizationAdmin({ organizationId: other.id, userId: user.id, name: 'أحمد', assignedBy: null });
    const again = await t.organizations.assignOrganizationAdmin({ organizationId: other.id, userId: user.id, assignedBy: null });
    expect(first.created).toBe(true);
    expect(again).toEqual({ assignmentId: first.assignmentId, created: false });
    expect(await t.organizations.isOrganizationAdmin(user.id, other.id)).toBe(true);
    expect(await t.organizations.isOrganizationAdmin(user.id, t.org.id)).toBe(false); // the other organization is out of scope
    expect(await t.organizations.listAdministeredOrganizationIds(user.id)).toEqual([other.id]);
    expect(t.events().filter((e) => e === 'OrganizationAdminAssigned')).toHaveLength(2); // the harness administrator and this one
    expect(await codeOf(t.organizations.assignOrganizationAdmin({ organizationId: COUNTRY, userId: user.id, assignedBy: null }))).toBe('ORGANIZATION_NOT_FOUND');
  });
});
