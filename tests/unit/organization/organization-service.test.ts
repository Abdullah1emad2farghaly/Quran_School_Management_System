import { describe, expect, it } from 'vitest';
import { AppError, type TransactionContext, type UnitOfWork } from '../../../src/modules/00-shared-kernel/public';
import { InMemoryOutboxStore, OutboxService } from '../../../src/modules/06-domain-events-outbox/public';
import {
  InMemoryOrganizationRepository,
  OrganizationEventTypes,
  OrganizationService,
  organizationError,
} from '../../../src/modules/13-organization-core/public';

function setup() {
  const clock = { now: () => new Date('2026-10-10T10:00:00Z') };
  const store = new InMemoryOutboxStore();
  const repository = new InMemoryOrganizationRepository();
  const unitOfWork: UnitOfWork = { run: (work) => work({} as TransactionContext) };
  const service = new OrganizationService({ repository, unitOfWork, outbox: new OutboxService(store, clock), clock });
  return { service, repository, store };
}
const codeOf = (p: Promise<unknown>) => p.then(() => 'NO_ERROR', (e: unknown) => (e instanceof AppError ? e.code : 'NOT_APP_ERROR'));

describe('OrganizationService.ensureMainOrganization', () => {
  it('creates the ACTIVE Main Organization with code ORG-000001 and one OrganizationCreated event', async () => {
    const { service, store } = setup();
    const { organization, created } = await service.ensureMainOrganization('  مؤسسة   النور ');
    expect(created).toBe(true);
    expect(organization).toMatchObject({ code: 'ORG-000001', name: 'مؤسسة النور', status: 'ACTIVE' });
    expect(Object.keys(organization).sort()).toEqual(['code', 'createdAt', 'id', 'name', 'status', 'updatedAt']); // approved fields only
    expect(store.messages.map((m) => m.eventType)).toEqual([OrganizationEventTypes.ORGANIZATION_CREATED]);
    expect(JSON.parse(store.messages[0]!.payload)).toEqual({ organizationId: organization.id, code: 'ORG-000001' });
  });

  it('is idempotent: re-running changes nothing, creates no second organization and no second event', async () => {
    const { service, store, repository } = setup();
    const first = await service.ensureMainOrganization('Al-Noor');
    const again = await service.ensureMainOrganization('Al-Noor');
    const different = await service.ensureMainOrganization('Another Name');
    expect(again).toEqual({ organization: first.organization, created: false });
    expect(different.created).toBe(false);
    expect(different.organization.name).toBe('Al-Noor'); // never renamed by the bootstrap
    expect(repository.rows.size).toBe(1);
    expect(store.messages).toHaveLength(1);
  });

  it('rejects an invalid name before reading or writing anything', async () => {
    const { service, store, repository } = setup();
    for (const bad of ['', '   ', 'x'.repeat(201)]) expect(await codeOf(service.ensureMainOrganization(bad))).toBe('INVALID_ORGANIZATION_NAME');
    expect(repository.rows.size).toBe(0);
    expect(store.messages).toHaveLength(0);
  });

  it('answers a lost creation race with the winner, without a duplicate or an extra event', async () => {
    const { service, store, repository } = setup();
    // A concurrent creator wins first (its own service, its own outbox).
    const winnerOutbox = new InMemoryOutboxStore();
    const winner = await new OrganizationService({
      repository,
      unitOfWork: { run: (work) => work({} as TransactionContext) },
      outbox: new OutboxService(winnerOutbox, { now: () => new Date() }),
    }).ensureMainOrganization('Winner');
    // Now make the loser's FIRST look miss the row (as if it read before the winner committed), so its insert hits the guard.
    const realFindMain = repository.findMain.bind(repository);
    let firstLook = true;
    repository.findMain = async (tx) => (firstLook ? ((firstLook = false), undefined) : realFindMain(tx));

    const loser = await service.ensureMainOrganization('Loser');
    expect(loser.created).toBe(false);
    expect(loser.organization.id).toBe(winner.organization.id);
    expect(repository.rows.size).toBe(1);
    expect(store.messages).toHaveLength(0); // the loser wrote no event
    expect(winnerOutbox.messages).toHaveLength(1);
  });

  it('validates the name even when the organization already exists', async () => {
    const { service } = setup();
    await service.ensureMainOrganization('Al-Noor');
    expect(await codeOf(service.ensureMainOrganization('   '))).toBe('INVALID_ORGANIZATION_NAME');
  });

  it('does not swallow other failures', async () => {
    const { service, repository } = setup();
    repository.insert = async () => {
      throw new Error('database down');
    };
    await expect(service.ensureMainOrganization('Al-Noor')).rejects.toThrow('database down');
  });
});

describe('Main Organization lookup contract', () => {
  it('returns undefined / throws ORGANIZATION_NOT_FOUND before creation, then the organization', async () => {
    const { service } = setup();
    expect(await service.getMainOrganization()).toBeUndefined();
    expect(await codeOf(service.requireMainOrganization())).toBe('ORGANIZATION_NOT_FOUND');
    const { organization } = await service.ensureMainOrganization('Al-Noor');
    expect(await service.getMainOrganization()).toEqual(organization);
    expect(await service.requireMainOrganization()).toEqual(organization);
    expect(await service.findById(organization.id)).toEqual(organization);
    expect(await service.findById('missing')).toBeUndefined();
  });

  it('the in-memory repository enforces the V1 single-organization rule', async () => {
    const { service, repository } = setup();
    await service.ensureMainOrganization('Al-Noor');
    const stored = [...repository.rows.values()][0]!;
    const second = (await import('../../../src/modules/13-organization-core/domain/entities/organization')).Organization.create({
      name: 'Second',
      code: 'ORG-000002',
      clock: { now: () => stored.createdAt },
    });
    await expect(repository.insert(second, {} as TransactionContext)).rejects.toMatchObject({ code: organizationError('ORGANIZATION_ALREADY_EXISTS').code });
  });
});
