import { describe, expect, it } from 'vitest';
import { AppError, FixedClock, type TransactionContext, type UnitOfWork } from '../../../src/modules/00-shared-kernel/public';
import { InMemoryOutboxStore, OutboxService } from '../../../src/modules/06-domain-events-outbox/public';
import { BcryptPasswordHasher, IdentityService, InMemoryUserRepository } from '../../../src/modules/08-identity-core/public';
import { RoleAssignment } from '../../../src/modules/09-roles-permissions/domain/entities/role-assignment';
import { roleError } from '../../../src/modules/09-roles-permissions/domain/errors/role-errors';
import {
  SequelizeRoleAssignmentRepository,
  isDeadlockError,
} from '../../../src/modules/09-roles-permissions/infrastructure/persistence/sequelize/repositories/sequelize-role-assignment-repository';
import { InMemoryRoleAssignmentRepository, PermissionRegistry, RoleService } from '../../../src/modules/09-roles-permissions/public';

const tx = {} as TransactionContext;
const unitOfWork: UnitOfWork = { run: (work) => work(tx) };

/** What mysql2 / Sequelize report for an InnoDB deadlock: a DatabaseError whose `parent` carries errno 1213. */
function deadlock(): Error {
  const error = new Error('Deadlock found when trying to get lock; try restarting transaction') as Error & {
    parent: { errno: number; code: string };
  };
  error.parent = { errno: 1213, code: 'ER_LOCK_DEADLOCK' };
  return error;
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

/** A user with PARENT + TEACHER whose first `failures` lock reads lose the race, as InnoDB would report it. */
async function setup(failures: number) {
  const clock = new FixedClock(new Date('2026-10-26T10:00:00Z'));
  const outbox = new OutboxService(new InMemoryOutboxStore(), clock);
  const identity = new IdentityService({ repository: new InMemoryUserRepository(), hasher: new BcryptPasswordHasher(4), unitOfWork, outbox, clock });
  const repository = new InMemoryRoleAssignmentRepository();
  let remaining = failures;
  let lockCalls = 0;
  const realLock = repository.lockAllByUser.bind(repository);
  repository.lockAllByUser = async (userId, t) => {
    lockCalls++;
    if (remaining > 0) {
      remaining--;
      throw roleError('ROLE_CONCURRENT_MODIFICATION');
    }
    return realLock(userId, t);
  };
  const service = new RoleService({ repository, identity, permissions: new PermissionRegistry(), unitOfWork, outbox, clock });
  const user = (await identity.createUser({ phone: '01010000001', password: 'secret1' })).id;
  await service.assignRole({ userId: user, roleCode: 'PARENT', assignedBy: null });
  await service.assignRole({ userId: user, roleCode: 'TEACHER', assignedBy: null });
  return { service, user, lockCalls: () => lockCalls };
}

describe('RoleService.revokeRole when it loses a race (InnoDB deadlock)', () => {
  it('retries and then succeeds', async () => {
    const { service, user, lockCalls } = await setup(1);
    await service.revokeRole({ userId: user, roleCode: 'PARENT', revokedBy: null });
    expect(lockCalls()).toBe(2);
    expect(await service.listActiveRoles(user)).toEqual(['TEACHER']);
  });

  it('reports the true outcome on the retry (the other revocation already left one role)', async () => {
    const { service, user } = await setup(1);
    // The race winner revokes TEACHER (its own call consumes the injected failure and retries), leaving only PARENT.
    await service.revokeRole({ userId: user, roleCode: 'TEACHER', revokedBy: null });
    expect(await codeOf(service.revokeRole({ userId: user, roleCode: 'PARENT', revokedBy: null }))).toBe('LAST_ACTIVE_ROLE');
  });

  it('gives up with the retryable ROLE_CONCURRENT_MODIFICATION after 3 attempts', async () => {
    const { service, user, lockCalls } = await setup(5);
    expect(await codeOf(service.revokeRole({ userId: user, roleCode: 'PARENT', revokedBy: null }))).toBe('ROLE_CONCURRENT_MODIFICATION');
    expect(lockCalls()).toBe(3);
  });

  it("does not retry inside the caller's own transaction (the caller owns it and gets the retryable code)", async () => {
    const { service, user, lockCalls } = await setup(1);
    expect(await codeOf(service.revokeRole({ userId: user, roleCode: 'PARENT', revokedBy: null }, tx))).toBe('ROLE_CONCURRENT_MODIFICATION');
    expect(lockCalls()).toBe(1);
  });
});

describe('SequelizeRoleAssignmentRepository deadlock handling', () => {
  const failingDb = { query: () => Promise.reject(deadlock()) } as never;
  const repository = new SequelizeRoleAssignmentRepository(failingDb);

  it('recognises InnoDB deadlocks on the error, its parent or its original, and nothing else', () => {
    expect(isDeadlockError(deadlock())).toBe(true);
    expect(isDeadlockError({ errno: 1213 })).toBe(true);
    expect(isDeadlockError({ original: { code: 'ER_LOCK_DEADLOCK' } })).toBe(true);
    expect(isDeadlockError(new Error('boom'))).toBe(false);
    expect(isDeadlockError(null)).toBe(false);
  });

  it('reports a deadlock on the FOR UPDATE read, the update and the insert as ROLE_CONCURRENT_MODIFICATION', async () => {
    const assignment = RoleAssignment.assign({ userId: 'u1', roleCode: 'TEACHER', assignedBy: null, clock: new FixedClock(new Date('2026-10-26T10:00:00Z')) });
    expect(await codeOf(repository.lockAllByUser('u1', undefined as never))).toBe('ROLE_CONCURRENT_MODIFICATION');
    expect(await codeOf(repository.update(assignment, undefined as never))).toBe('ROLE_CONCURRENT_MODIFICATION');
    expect(await codeOf(repository.insert(assignment, undefined as never))).toBe('ROLE_CONCURRENT_MODIFICATION');
  });

  it('lets other database errors through unchanged', async () => {
    const boom = new SequelizeRoleAssignmentRepository({ query: () => Promise.reject(new Error('boom')) } as never);
    await expect(boom.lockAllByUser('u1', undefined as never)).rejects.toThrow('boom');
  });
});
