import { describe, expect, it } from 'vitest';
import { AppError, FixedClock, type TransactionContext, type UnitOfWork } from '../../../src/modules/00-shared-kernel/public';
import { InMemoryOutboxStore, OutboxService } from '../../../src/modules/06-domain-events-outbox/public';
import { BcryptPasswordHasher, IdentityService, InMemoryUserRepository } from '../../../src/modules/08-identity-core/public';
import {
  InMemoryRoleAssignmentRepository,
  PermissionRegistry,
  RoleEventTypes,
  RoleService,
} from '../../../src/modules/09-roles-permissions/public';

const tx = {} as TransactionContext;
const unitOfWork: UnitOfWork = { run: (work) => work(tx) };

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof AppError) return e.code;
    throw e;
  }
  return 'OK';
}

function setup() {
  let now = new Date('2026-10-08T10:00:00Z');
  const clock = { now: () => now };
  const tick = (minutes: number) => {
    now = new Date(now.getTime() + minutes * 60_000);
  };
  const store = new InMemoryOutboxStore();
  const outbox = new OutboxService(store, new FixedClock(now));
  const identity = new IdentityService({
    repository: new InMemoryUserRepository(),
    hasher: new BcryptPasswordHasher(4),
    unitOfWork,
    outbox,
    clock,
  });
  const permissions = new PermissionRegistry();
  permissions.register({ code: 'schools.school.create', roles: ['MAIN_ADMIN'] });
  permissions.register({ code: 'attendance.session.record', roles: ['TEACHER', 'SCHOOL_MANAGER'] });
  const repository = new InMemoryRoleAssignmentRepository();
  const service = new RoleService({ repository, identity, permissions, unitOfWork, outbox, clock });
  let n = 0;
  const newUser = async () => (await identity.createUser({ phone: `010${String(10000000 + ++n)}`, password: 'secret1' })).id;
  const roleEvents = () => store.messages.filter((m) => m.aggregateType === 'RoleAssignment').map((m) => m.eventType);
  return { service, repository, newUser, tick, roleEvents, store };
}

describe('RoleService.assignRole', () => {
  it('assigns a role with who and when, and publishes RoleAssigned', async () => {
    const { service, newUser, roleEvents, store } = setup();
    const admin = await newUser();
    const user = await newUser();

    const a = await service.assignRole({ userId: user, roleCode: 'TEACHER', assignedBy: admin });
    expect(a).toMatchObject({ userId: user, roleCode: 'TEACHER', assignedBy: admin, isActive: true, revokedAt: null, revokedBy: null });
    expect(a.assignedAt).toEqual(new Date('2026-10-08T10:00:00Z'));
    expect(roleEvents()).toEqual([RoleEventTypes.ROLE_ASSIGNED]);
    const payload = JSON.parse(store.messages.find((m) => m.aggregateType === 'RoleAssignment')!.payload);
    expect(payload).toEqual({ assignmentId: a.id, userId: user, roleCode: 'TEACHER' });
  });

  it('allows the system as actor (assignedBy null), e.g. for the first Main Admin', async () => {
    const { service, newUser } = setup();
    const user = await newUser();
    expect((await service.assignRole({ userId: user, roleCode: 'MAIN_ADMIN', assignedBy: null })).assignedBy).toBeNull();
  });

  it('allows several different roles for one user (e.g. Parent and Teacher, §19)', async () => {
    const { service, newUser } = setup();
    const user = await newUser();
    await service.assignRole({ userId: user, roleCode: 'PARENT', assignedBy: null });
    await service.assignRole({ userId: user, roleCode: 'TEACHER', assignedBy: null });
    expect(await service.listActiveRoles(user)).toEqual(['TEACHER', 'PARENT']);
  });

  it('never duplicates an active role', async () => {
    const { service, newUser, roleEvents } = setup();
    const user = await newUser();
    await service.assignRole({ userId: user, roleCode: 'TEACHER', assignedBy: null });
    expect(await codeOf(service.assignRole({ userId: user, roleCode: 'TEACHER', assignedBy: null }))).toBe('ROLE_ALREADY_ASSIGNED');
    expect(await service.listRoleHistory(user)).toHaveLength(1);
    expect(roleEvents()).toHaveLength(1);
  });

  it('rejects Student, unknown roles, and removed roles (Supervisor)', async () => {
    const { service, newUser, repository } = setup();
    const user = await newUser();
    expect(await codeOf(service.assignRole({ userId: user, roleCode: 'STUDENT', assignedBy: null }))).toBe('ROLE_NOT_ASSIGNABLE');
    for (const roleCode of ['SUPERVISOR', 'COMPETITION_MANAGER', 'teacher', '']) {
      expect(await codeOf(service.assignRole({ userId: user, roleCode, assignedBy: null }))).toBe('INVALID_ROLE');
    }
    expect(repository.rows.size).toBe(0);
  });

  it('rejects an unknown user or an unknown actor', async () => {
    const { service, newUser, repository } = setup();
    const user = await newUser();
    const ghost = '00000000-0000-4000-8000-000000000000';
    expect(await codeOf(service.assignRole({ userId: ghost, roleCode: 'TEACHER', assignedBy: null }))).toBe('USER_NOT_FOUND');
    expect(await codeOf(service.assignRole({ userId: user, roleCode: 'TEACHER', assignedBy: ghost }))).toBe('USER_NOT_FOUND');
    expect(repository.rows.size).toBe(0);
  });
});

describe('RoleService.revokeRole and history (§19)', () => {
  it('keeps the revoked row with who/when, and publishes RoleRevoked', async () => {
    const { service, newUser, tick, roleEvents } = setup();
    const admin = await newUser();
    const user = await newUser();
    await service.assignRole({ userId: user, roleCode: 'PARENT', assignedBy: admin });
    await service.assignRole({ userId: user, roleCode: 'TEACHER', assignedBy: admin });
    tick(60);

    const revoked = await service.revokeRole({ userId: user, roleCode: 'TEACHER', revokedBy: admin });
    expect(revoked).toMatchObject({ roleCode: 'TEACHER', isActive: false, revokedBy: admin, assignedBy: admin });
    expect(revoked.revokedAt).toEqual(new Date('2026-10-08T11:00:00Z'));
    expect(await service.listActiveRoles(user)).toEqual(['PARENT']);
    expect(await service.listRoleHistory(user)).toHaveLength(2);
    expect(roleEvents()).toEqual([RoleEventTypes.ROLE_ASSIGNED, RoleEventTypes.ROLE_ASSIGNED, RoleEventTypes.ROLE_REVOKED]);
  });

  it('never revokes the last active role, whichever role it is', async () => {
    const { service, newUser, roleEvents } = setup();
    const user = await newUser();
    await service.assignRole({ userId: user, roleCode: 'PARENT', assignedBy: null });
    expect(await codeOf(service.revokeRole({ userId: user, roleCode: 'PARENT', revokedBy: null }))).toBe('LAST_ACTIVE_ROLE');
    expect(await service.listActiveRoles(user)).toEqual(['PARENT']);
    expect(roleEvents()).toEqual([RoleEventTypes.ROLE_ASSIGNED]);
  });

  it('changes a role by assigning the new one first, then revoking the old one', async () => {
    const { service, newUser } = setup();
    const user = await newUser();
    await service.assignRole({ userId: user, roleCode: 'SCHOOL_MANAGER', assignedBy: null });
    await service.assignRole({ userId: user, roleCode: 'TEACHER', assignedBy: null });
    await service.revokeRole({ userId: user, roleCode: 'SCHOOL_MANAGER', revokedBy: null });
    expect(await service.listActiveRoles(user)).toEqual(['TEACHER']);
  });

  it('lets a revoked role be assigned again as a NEW row, keeping the old period in history', async () => {
    const { service, newUser, tick } = setup();
    const user = await newUser();
    await service.assignRole({ userId: user, roleCode: 'PARENT', assignedBy: null });
    const first = await service.assignRole({ userId: user, roleCode: 'TEACHER', assignedBy: null });
    tick(10);
    await service.revokeRole({ userId: user, roleCode: 'TEACHER', revokedBy: null });
    tick(10);
    const second = await service.assignRole({ userId: user, roleCode: 'TEACHER', assignedBy: null });

    expect(second.id).not.toBe(first.id);
    const history = await service.listRoleHistory(user);
    expect(history.filter((h) => h.roleCode === 'TEACHER').map((h) => h.isActive)).toEqual([false, true]);
    expect(history).toHaveLength(3);
  });

  it('rejects revoking a role the user does not currently have', async () => {
    const { service, newUser } = setup();
    const user = await newUser();
    await service.assignRole({ userId: user, roleCode: 'PARENT', assignedBy: null });
    await service.assignRole({ userId: user, roleCode: 'TEACHER', assignedBy: null });
    expect(await codeOf(service.revokeRole({ userId: user, roleCode: 'SCHOOL_MANAGER', revokedBy: null }))).toBe('ROLE_ASSIGNMENT_NOT_FOUND');
    await service.revokeRole({ userId: user, roleCode: 'TEACHER', revokedBy: null });
    expect(await codeOf(service.revokeRole({ userId: user, roleCode: 'TEACHER', revokedBy: null }))).toBe('ROLE_ASSIGNMENT_NOT_FOUND');
    expect(await codeOf(service.revokeRole({ userId: user, roleCode: 'SUPERVISOR', revokedBy: null }))).toBe('INVALID_ROLE');
  });
});

describe('RoleService permission checks (§20: roles -> permissions)', () => {
  it('grants a permission only through an ACTIVE role', async () => {
    const { service, newUser } = setup();
    const user = await newUser();
    await service.assignRole({ userId: user, roleCode: 'PARENT', assignedBy: null });
    await service.assignRole({ userId: user, roleCode: 'TEACHER', assignedBy: null });

    expect(await service.hasPermission(user, 'attendance.session.record')).toBe(true);
    expect(await service.hasPermission(user, 'schools.school.create')).toBe(false);
    expect(await service.listPermissions(user)).toEqual(['attendance.session.record']);

    await service.revokeRole({ userId: user, roleCode: 'TEACHER', revokedBy: null });
    expect(await service.hasPermission(user, 'attendance.session.record')).toBe(false);
    expect(await service.listPermissions(user)).toEqual([]);
  });

  it('denies unknown permissions, unknown users and users without roles', async () => {
    const { service, newUser } = setup();
    const user = await newUser();
    expect(await service.hasPermission(user, 'attendance.session.record')).toBe(false);
    expect(await service.hasPermission('00000000-0000-4000-8000-000000000000', 'attendance.session.record')).toBe(false);
    await service.assignRole({ userId: user, roleCode: 'MAIN_ADMIN', assignedBy: null });
    expect(await service.hasPermission(user, 'made.up.permission')).toBe(false);
  });

  it('supports hasRole / hasAnyRole', async () => {
    const { service, newUser } = setup();
    const user = await newUser();
    await service.assignRole({ userId: user, roleCode: 'PARENT', assignedBy: null });
    expect(await service.hasRole(user, 'PARENT')).toBe(true);
    expect(await service.hasRole(user, 'TEACHER')).toBe(false);
    expect(await service.hasAnyRole(user, ['TEACHER', 'PARENT'])).toBe(true);
    expect(await service.hasAnyRole(user, ['TEACHER'])).toBe(false);
  });
});

describe('optimistic locking', () => {
  it('rejects an update from a stale copy', async () => {
    const { service, repository, newUser } = setup();
    const user = await newUser();
    await service.assignRole({ userId: user, roleCode: 'PARENT', assignedBy: null });
    await service.assignRole({ userId: user, roleCode: 'TEACHER', assignedBy: null });
    const [a, b] = (await repository.findActiveByUser(user)).filter((x) => x.roleCode === 'TEACHER').concat(
      (await repository.findActiveByUser(user)).filter((x) => x.roleCode === 'TEACHER'),
    );
    const clock = { now: () => new Date() };
    a!.revoke(null, clock);
    await repository.update(a!, tx);
    b!.revoke(null, clock);
    expect(await codeOf(repository.update(b!, tx))).toBe('ROLE_CONCURRENT_MODIFICATION');
  });
});
