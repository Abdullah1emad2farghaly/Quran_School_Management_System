import { describe, expect, it } from 'vitest';
import { AppError, FixedClock, type TransactionContext, type UnitOfWork } from '../../../src/modules/00-shared-kernel/public';
import { InMemoryOutboxStore, OutboxService } from '../../../src/modules/06-domain-events-outbox/public';
import {
  BcryptPasswordHasher,
  IdentityEventTypes,
  IdentityService,
  InMemoryUserRepository,
  initialPasswordFromPhone,
} from '../../../src/modules/08-identity-core/public';

const clock = new FixedClock(new Date('2026-10-07T10:00:00Z'));
const tx = {} as TransactionContext;

function setup() {
  const repository = new InMemoryUserRepository();
  const store = new InMemoryOutboxStore();
  let runCount = 0;
  const unitOfWork: UnitOfWork = {
    async run(work) {
      runCount += 1;
      return work(tx);
    },
  };
  const service = new IdentityService({
    repository,
    hasher: new BcryptPasswordHasher(4),
    unitOfWork,
    outbox: new OutboxService(store, clock),
    clock,
  });
  const eventTypes = () => store.messages.map((m) => m.eventType);
  return { service, repository, store, runs: () => runCount, eventTypes };
}

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof AppError) return e.code;
    throw e;
  }
  return 'OK';
}

describe('IdentityService.createUser', () => {
  it('creates an ACTIVE user with a normalized phone and a hashed password', async () => {
    const { service, repository } = setup();
    const user = await service.createUser({ phone: '010 1234 5678', password: 'secret1' });

    expect(user).toMatchObject({ phone: '+201012345678', status: 'ACTIVE', isActive: true });
    const stored = repository.rows.get(user.id)!;
    expect(stored.passwordHash).toMatch(/^\$2[aby]\$/);
    expect(stored.passwordHash).not.toContain('secret1');
  });

  it('never exposes the password or hash in the returned DTO', async () => {
    const { service } = setup();
    const user = await service.createUser({ phone: '01012345678', password: 'secret1' });
    expect(Object.keys(user).sort()).toEqual(
      ['createdAt', 'id', 'isActive', 'phone', 'status', 'statusChangedAt', 'updatedAt'].sort(),
    );
    expect(JSON.stringify(user)).not.toContain('secret1');
  });

  it('publishes UserCreated to the outbox, without phone or password', async () => {
    const { service, store, eventTypes } = setup();
    const user = await service.createUser({ phone: '01012345678', password: 'secret1' });
    expect(eventTypes()).toEqual([IdentityEventTypes.USER_CREATED]);
    expect(JSON.parse(store.messages[0]!.payload)).toEqual({ userId: user.id });
  });

  it('runs inside one transaction when none is supplied', async () => {
    const { service, runs } = setup();
    await service.createUser({ phone: '01012345678', password: 'secret1' });
    expect(runs()).toBe(1);
  });

  it("joins the caller's transaction instead of opening a new one", async () => {
    const { service, runs } = setup();
    await service.createUser({ phone: '01012345678', password: 'secret1' }, tx);
    expect(runs()).toBe(0);
  });

  it('rejects a duplicate phone written in ANY format, and never merges', async () => {
    const { service, repository, eventTypes } = setup();
    const first = await service.createUser({ phone: '01012345678', password: 'secret1' });
    for (const phone of ['+201012345678', '00201012345678', '010 1234 5678', '٠١٠١٢٣٤٥٦٧٨']) {
      expect(await codeOf(service.createUser({ phone, password: 'another1' }))).toBe('USER_PHONE_ALREADY_EXISTS');
    }
    expect(repository.rows.size).toBe(1);
    expect(repository.rows.get(first.id)!.passwordHash).toBeDefined();
    expect(eventTypes()).toEqual([IdentityEventTypes.USER_CREATED]);
  });

  it('rejects an invalid phone or password before storing anything', async () => {
    const { service, repository, store } = setup();
    expect(await codeOf(service.createUser({ phone: 'abc', password: 'secret1' }))).toBe('INVALID_PHONE_NUMBER');
    expect(await codeOf(service.createUser({ phone: '01012345678', password: '123' }))).toBe('INVALID_PASSWORD');
    expect(await codeOf(service.createUser({ phone: '01012345678', password: 'x'.repeat(13) }))).toBe('INVALID_PASSWORD');
    expect(repository.rows.size).toBe(0);
    expect(store.messages).toHaveLength(0);
  });

  it('supports the §24 initial password (last 4 digits of the phone)', async () => {
    const { service } = setup();
    const phone = '010 1234 5678';
    const user = await service.createUser({ phone, password: initialPasswordFromPhone(phone) });
    expect(await service.verifyPassword(user.id, '5678')).toBe(true);
  });
});

describe('IdentityService lookups', () => {
  it('finds by phone in any accepted format and by id', async () => {
    const { service } = setup();
    const user = await service.createUser({ phone: '01012345678', password: 'secret1' });
    expect((await service.findByPhone('+20 101 234 5678'))?.id).toBe(user.id);
    expect((await service.findById(user.id))?.phone).toBe('+201012345678');
    expect((await service.getById(user.id)).id).toBe(user.id);
  });

  it('returns undefined for unknown users and throws USER_NOT_FOUND from getById', async () => {
    const { service } = setup();
    expect(await service.findByPhone('01099999999')).toBeUndefined();
    expect(await service.findById('00000000-0000-4000-8000-000000000000')).toBeUndefined();
    expect(await codeOf(service.getById('00000000-0000-4000-8000-000000000000'))).toBe('USER_NOT_FOUND');
  });

  it('rejects a malformed phone in findByPhone', async () => {
    const { service } = setup();
    expect(await codeOf(service.findByPhone('abc'))).toBe('INVALID_PHONE_NUMBER');
  });
});

describe('IdentityService.verifyPassword', () => {
  it('accepts the right password only, and is false for unknown users', async () => {
    const { service } = setup();
    const user = await service.createUser({ phone: '01012345678', password: 'secret1' });
    expect(await service.verifyPassword(user.id, 'secret1')).toBe(true);
    expect(await service.verifyPassword(user.id, 'Secret1')).toBe(false);
    expect(await service.verifyPassword(user.id, '')).toBe(false);
    expect(await service.verifyPassword('00000000-0000-4000-8000-000000000000', 'secret1')).toBe(false);
  });
});

describe('IdentityService lifecycle (§22)', () => {
  it('deactivates and reactivates, keeping the user and its history', async () => {
    const { service, repository, eventTypes } = setup();
    const user = await service.createUser({ phone: '01012345678', password: 'secret1' });

    const inactive = await service.deactivateUser(user.id);
    expect(inactive).toMatchObject({ status: 'INACTIVE', isActive: false });
    expect(repository.rows.size).toBe(1);
    expect(repository.rows.get(user.id)!.version).toBe(2);

    const active = await service.activateUser(user.id);
    expect(active).toMatchObject({ status: 'ACTIVE', isActive: true });
    expect(repository.rows.get(user.id)!.version).toBe(3);

    expect(eventTypes()).toEqual([
      IdentityEventTypes.USER_CREATED,
      IdentityEventTypes.USER_DEACTIVATED,
      IdentityEventTypes.USER_ACTIVATED,
    ]);
  });

  it('keeps the password and phone while inactive (reversible)', async () => {
    const { service } = setup();
    const user = await service.createUser({ phone: '01012345678', password: 'secret1' });
    await service.deactivateUser(user.id);
    expect(await service.verifyPassword(user.id, 'secret1')).toBe(true); // callers must also check isActive
    expect((await service.getById(user.id)).isActive).toBe(false);
    expect(await codeOf(service.createUser({ phone: '01012345678', password: 'other12' }))).toBe('USER_PHONE_ALREADY_EXISTS');
  });

  it('rejects invalid transitions without publishing events', async () => {
    const { service, eventTypes } = setup();
    const user = await service.createUser({ phone: '01012345678', password: 'secret1' });
    expect(await codeOf(service.activateUser(user.id))).toBe('USER_ALREADY_ACTIVE');
    await service.deactivateUser(user.id);
    expect(await codeOf(service.deactivateUser(user.id))).toBe('USER_ALREADY_INACTIVE');
    expect(eventTypes()).toEqual([IdentityEventTypes.USER_CREATED, IdentityEventTypes.USER_DEACTIVATED]);
  });

  it('throws USER_NOT_FOUND for unknown users', async () => {
    const { service } = setup();
    const id = '00000000-0000-4000-8000-000000000000';
    expect(await codeOf(service.deactivateUser(id))).toBe('USER_NOT_FOUND');
    expect(await codeOf(service.activateUser(id))).toBe('USER_NOT_FOUND');
    expect(await codeOf(service.changePassword(id, 'secret1'))).toBe('USER_NOT_FOUND');
  });
});

describe('IdentityService.changePassword', () => {
  it('replaces the password, enforces the policy, and publishes UserPasswordChanged', async () => {
    const { service, eventTypes, repository } = setup();
    const user = await service.createUser({ phone: '01012345678', password: 'secret1' });
    const before = repository.rows.get(user.id)!.passwordHash;

    await service.changePassword(user.id, 'newpass9');
    expect(await service.verifyPassword(user.id, 'secret1')).toBe(false);
    expect(await service.verifyPassword(user.id, 'newpass9')).toBe(true);
    expect(repository.rows.get(user.id)!.passwordHash).not.toBe(before);
    expect(eventTypes()).toEqual([IdentityEventTypes.USER_CREATED, IdentityEventTypes.USER_PASSWORD_CHANGED]);

    expect(await codeOf(service.changePassword(user.id, '12'))).toBe('INVALID_PASSWORD');
    expect(await service.verifyPassword(user.id, 'newpass9')).toBe(true);
  });
});

describe('optimistic locking', () => {
  it('rejects an update made from a stale copy', async () => {
    const { repository } = setup();
    const { User } = await import('../../../src/modules/08-identity-core/domain/entities/user');
    const user = User.create({ phone: '01012345678', passwordHash: 'h', clock });
    await repository.insert(user, tx);

    const a = (await repository.findById(user.id))!;
    const b = (await repository.findById(user.id))!;
    a.deactivate(clock);
    await repository.update(a, tx);
    b.replacePasswordHash('other', clock);
    expect(await codeOf(repository.update(b, tx))).toBe('USER_CONCURRENT_MODIFICATION');
  });
});
