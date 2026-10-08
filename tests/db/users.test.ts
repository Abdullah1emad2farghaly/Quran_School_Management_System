/**
 * Real-database checks for Module 08 users (MariaDB via XAMPP). NOT part of `npm test`.
 * Prerequisite: `npm run db:migrate` (creates users and outbox_messages). Run: npm run test:db
 * Test users use phones starting with +2010999 followed by 5 digits (never real numbers); they and their outbox
 * rows are deleted afterwards.
 */
import { QueryTypes } from 'sequelize';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { env } from '../../src/config/env';
import { AppError } from '../../src/modules/00-shared-kernel/public';
import { SequelizeUnitOfWork, createSequelize } from '../../src/modules/02-database/public';
import { OutboxService, SequelizeOutboxStore } from '../../src/modules/06-domain-events-outbox/public';
import { User } from '../../src/modules/08-identity-core/domain/entities/user';
import {
  BcryptPasswordHasher,
  IdentityEventTypes,
  IdentityService,
  SequelizeUserRepository,
} from '../../src/modules/08-identity-core/public';
import { SystemClock } from '../../src/modules/00-shared-kernel/public';

const sequelize = createSequelize(env.database);
const uow = new SequelizeUnitOfWork(sequelize);
const repository = new SequelizeUserRepository(sequelize);
const service = new IdentityService({
  repository,
  hasher: new BcryptPasswordHasher(4),
  unitOfWork: uow,
  outbox: new OutboxService(new SequelizeOutboxStore(sequelize)),
});

const PREFIX = '+2010999';
// +20 10999 + 5 digits = a valid 10-digit Egyptian mobile number after +20.
let counter = Math.floor(Math.random() * 50000);
const nextPhone = () => `${PREFIX}${String(++counter).padStart(5, '0')}`;
const localOf = (e164: string) => `0${e164.slice(3)}`; // +2010999xxxxx -> 010999xxxxx

async function cleanup() {
  await sequelize.query(
    `DELETE FROM outbox_messages WHERE aggregate_type = 'User' AND aggregate_id IN
       (SELECT id FROM users WHERE phone LIKE '${PREFIX}%')`,
  );
  await sequelize.query(`DELETE FROM users WHERE phone LIKE '${PREFIX}%'`);
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
const rowOf = async (id: string) =>
  (
    await sequelize.query<{ phone: string; password_hash: string; status: string; version: number }>(
      'SELECT phone, password_hash, status, version FROM users WHERE id = :id',
      { replacements: { id }, type: QueryTypes.SELECT },
    )
  )[0];

describe('users (MariaDB)', () => {
  beforeAll(cleanup);
  afterAll(async () => {
    await cleanup();
    await sequelize.close();
  });

  it('stores a normalized phone and a bcrypt hash, and finds the user by any phone format', async () => {
    const phone = nextPhone();
    const user = await service.createUser({ phone: localOf(phone), password: 'secret1' });
    const row = await rowOf(user.id);
    expect(row?.phone).toBe(phone);
    expect(row?.status).toBe('ACTIVE');
    expect(row?.version).toBe(1);
    expect(row?.password_hash).toMatch(/^\$2[aby]\$/);
    expect(row?.password_hash).not.toContain('secret1');
    expect((await service.findByPhone(phone))?.id).toBe(user.id);
    expect((await service.findByPhone(`00${phone.slice(1)}`))?.id).toBe(user.id);
    expect(await service.verifyPassword(user.id, 'secret1')).toBe(true);
    expect(await service.verifyPassword(user.id, 'wrong')).toBe(false);
  });

  it('keeps a phone unique globally (service check and database guard)', async () => {
    const phone = nextPhone();
    await service.createUser({ phone, password: 'secret1' });
    expect(await codeOf(service.createUser({ phone: localOf(phone), password: 'other12' }))).toBe('USER_PHONE_ALREADY_EXISTS');

    // Race: bypass the service-level check; the unique index must still reject it.
    const clone = User.create({ phone, passwordHash: 'h', clock: new SystemClock() });
    expect(await codeOf(uow.run((tx) => repository.insert(clone, tx)))).toBe('USER_PHONE_ALREADY_EXISTS');
  });

  it('persists the ACTIVE/INACTIVE lifecycle and increments the version', async () => {
    const user = await service.createUser({ phone: nextPhone(), password: 'secret1' });
    await service.deactivateUser(user.id);
    expect(await rowOf(user.id)).toMatchObject({ status: 'INACTIVE', version: 2 });
    expect((await service.getById(user.id)).isActive).toBe(false);
    await service.activateUser(user.id);
    expect(await rowOf(user.id)).toMatchObject({ status: 'ACTIVE', version: 3 });
    expect(await codeOf(service.activateUser(user.id))).toBe('USER_ALREADY_ACTIVE');
  });

  it('rejects a stale update (optimistic lock)', async () => {
    const created = await service.createUser({ phone: nextPhone(), password: 'secret1' });
    const a = (await repository.findById(created.id))!;
    const b = (await repository.findById(created.id))!;
    a.deactivate(new SystemClock());
    await uow.run((tx) => repository.update(a, tx));
    b.replacePasswordHash('other', new SystemClock());
    expect(await codeOf(uow.run((tx) => repository.update(b, tx)))).toBe('USER_CONCURRENT_MODIFICATION');
  });

  it('changes the password', async () => {
    const user = await service.createUser({ phone: nextPhone(), password: 'secret1' });
    await service.changePassword(user.id, 'newpass9');
    expect(await service.verifyPassword(user.id, 'secret1')).toBe(false);
    expect(await service.verifyPassword(user.id, 'newpass9')).toBe(true);
  });

  it('writes the user and its UserCreated event atomically (events carry no phone or password)', async () => {
    const user = await service.createUser({ phone: nextPhone(), password: 'secret1' });
    const events = await sequelize.query<{ event_type: string; payload: string }>(
      "SELECT event_type, payload FROM outbox_messages WHERE aggregate_type = 'User' AND aggregate_id = :id",
      { replacements: { id: user.id }, type: QueryTypes.SELECT },
    );
    expect(events.map((e) => e.event_type)).toEqual([IdentityEventTypes.USER_CREATED]);
    expect(JSON.parse(events[0]!.payload)).toEqual({ userId: user.id });
  });

  it('rolls back the user AND its event when the surrounding transaction fails', async () => {
    const phone = nextPhone();
    let id = '';
    try {
      await uow.run(async (tx) => {
        id = (await service.createUser({ phone, password: 'secret1' }, tx)).id;
        throw new Error('rollback');
      });
    } catch {
      /* expected */
    }
    expect(id).not.toBe('');
    expect(await rowOf(id)).toBeUndefined();
    expect(await service.findByPhone(phone)).toBeUndefined();
    const events = await sequelize.query('SELECT 1 FROM outbox_messages WHERE aggregate_id = :id', {
      replacements: { id },
      type: QueryTypes.SELECT,
    });
    expect(events).toHaveLength(0);
  });

  it('lets only ACTIVE or INACTIVE exist in the database', async () => {
    const user = await service.createUser({ phone: nextPhone(), password: 'secret1' });
    await expect(sequelize.query("UPDATE users SET status = 'DELETED' WHERE id = :id", { replacements: { id: user.id } })).rejects.toThrow();
  });
});
