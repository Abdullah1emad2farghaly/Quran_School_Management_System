import { describe, expect, it } from 'vitest';
import { AppError, type TransactionContext, type UnitOfWork } from '../../../src/modules/00-shared-kernel/public';
import { InMemoryOutboxStore, OutboxService } from '../../../src/modules/06-domain-events-outbox/public';
import { InMemoryOrganizationRepository, OrganizationEventTypes, OrganizationService } from '../../../src/modules/13-organization-core/public';

const EGYPT = '0b6f7e0e-2b6a-4a57-9a4e-6f1d2c3b4a51';
const OTHER = '5d1c8f3a-7c9b-4e21-8b0a-1a2b3c4d5e6f';

function setup() {
  let now = new Date('2026-10-11T10:00:00Z');
  const clock = { now: () => now };
  const store = new InMemoryOutboxStore();
  const repository = new InMemoryOrganizationRepository();
  const unitOfWork: UnitOfWork = { run: (work) => work({} as TransactionContext) };
  const service = new OrganizationService({ repository, unitOfWork, outbox: new OutboxService(store, clock), clock });
  return { service, repository, store, advance: () => (now = new Date(now.getTime() + 60_000)) };
}
const codeOf = (p: Promise<unknown>) => p.then(() => 'NO_ERROR', (e: unknown) => (e instanceof AppError ? e.code : 'NOT_APP_ERROR'));
const countryEvents = (store: InMemoryOutboxStore) => store.messages.filter((m) => m.eventType === OrganizationEventTypes.ORGANIZATION_COUNTRY_ASSIGNED);

describe('OrganizationService.assignMainOrganizationCountry', () => {
  it('assigns the country once: stores the primary key, bumps updatedAt, writes one OrganizationCountryAssigned event with ids only', async () => {
    const { service, store, advance } = setup();
    const { organization: created } = await service.ensureMainOrganization('Al-Noor');
    advance();
    const result = await service.assignMainOrganizationCountry(EGYPT);
    expect(result.changed).toBe(true);
    expect(result.organization).toMatchObject({ id: created.id, countryId: EGYPT });
    expect(result.organization.updatedAt.getTime()).toBeGreaterThan(created.updatedAt.getTime());
    expect((await service.getMainOrganization())?.countryId).toBe(EGYPT);
    expect(countryEvents(store)).toHaveLength(1);
    expect(JSON.parse(countryEvents(store)[0]!.payload)).toEqual({ organizationId: created.id, countryId: EGYPT });
  });

  it('is idempotent for the same country: no change, no second event', async () => {
    const { service, store } = setup();
    await service.ensureMainOrganization('Al-Noor');
    await service.assignMainOrganizationCountry(EGYPT);
    const again = await service.assignMainOrganizationCountry(EGYPT);
    const upper = await service.assignMainOrganizationCountry(EGYPT.toUpperCase());
    expect(again.changed).toBe(false);
    expect(upper.changed).toBe(false);
    expect(countryEvents(store)).toHaveLength(1);
  });

  it('rejects a different country (immutable in V1) and changes nothing', async () => {
    const { service, store } = setup();
    await service.ensureMainOrganization('Al-Noor');
    await service.assignMainOrganizationCountry(EGYPT);
    expect(await codeOf(service.assignMainOrganizationCountry(OTHER))).toBe('ORGANIZATION_COUNTRY_ALREADY_SET');
    expect((await service.getMainOrganization())?.countryId).toBe(EGYPT);
    expect(countryEvents(store)).toHaveLength(1);
  });

  it('rejects anything that is not a country primary key, such as the country CODE, before touching the data', async () => {
    const { service, store } = setup();
    await service.ensureMainOrganization('Al-Noor');
    for (const bad of ['CNT-000001', '', '   ', 'not-a-uuid', 42, null, undefined]) {
      expect(await codeOf(service.assignMainOrganizationCountry(bad))).toBe('ORGANIZATION_COUNTRY_INVALID');
    }
    expect((await service.getMainOrganization())?.countryId).toBeNull();
    expect(countryEvents(store)).toHaveLength(0);
  });

  it('needs the Main Organization', async () => {
    const { service } = setup();
    expect(await codeOf(service.assignMainOrganizationCountry(EGYPT))).toBe('ORGANIZATION_NOT_FOUND');
  });

  it('refuses when the set-once update finds the country already set (lost race), without an event', async () => {
    const { service, repository, store } = setup();
    await service.ensureMainOrganization('Al-Noor');
    const real = repository.findMainForUpdate.bind(repository);
    // The organization is read before another process assigned the country, so the set-once UPDATE affects no row.
    repository.findMainForUpdate = async (tx) => {
      const stale = await real(tx);
      const row = [...repository.rows.values()][0]!;
      repository.rows.set(row.id, { ...row, countryId: OTHER });
      return stale;
    };
    expect(await codeOf(service.assignMainOrganizationCountry(EGYPT))).toBe('ORGANIZATION_COUNTRY_ALREADY_SET');
    expect(countryEvents(store)).toHaveLength(0);
  });
});

describe('OrganizationService.requireMainOrganizationCountryId', () => {
  it('fails closed until the country is assigned, then returns the primary key', async () => {
    const { service } = setup();
    expect(await codeOf(service.requireMainOrganizationCountryId())).toBe('ORGANIZATION_NOT_FOUND');
    await service.ensureMainOrganization('Al-Noor');
    expect(await codeOf(service.requireMainOrganizationCountryId())).toBe('ORGANIZATION_COUNTRY_NOT_SET');
    await service.assignMainOrganizationCountry(EGYPT);
    expect(await service.requireMainOrganizationCountryId()).toBe(EGYPT);
  });
});
