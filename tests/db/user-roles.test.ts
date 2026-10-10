/**
 * Real-database checks for Module 09 role assignments (MariaDB via XAMPP). NOT part of `npm test`.
 * Prerequisite: `npm run db:migrate` (creates users, user_roles and outbox_messages, including the state-check fix). Run: npm run test:db
 * Test users use phones starting with +2010998 followed by 5 digits (never real numbers); they, their
 * role rows and their outbox rows are deleted afterwards.
 */
import { QueryTypes } from 'sequelize';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { env } from '../../src/config/env';
import { AppError, SystemClock } from '../../src/modules/00-shared-kernel/public';
import { SequelizeUnitOfWork, createSequelize } from '../../src/modules/02-database/public';
import { OutboxService, SequelizeOutboxStore } from '../../src/modules/06-domain-events-outbox/public';
import { BcryptPasswordHasher, IdentityService, SequelizeUserRepository } from '../../src/modules/08-identity-core/public';
import { RoleAssignment } from '../../src/modules/09-roles-permissions/domain/entities/role-assignment';
import {
  PermissionRegistry,
  RoleEventTypes,
  RoleService,
  SequelizeRoleAssignmentRepository,
} from '../../src/modules/09-roles-permissions/public';

const sequelize = createSequelize(env.database);
const uow = new SequelizeUnitOfWork(sequelize);
const outbox = new OutboxService(new SequelizeOutboxStore(sequelize));
const identity = new IdentityService({
  repository: new SequelizeUserRepository(sequelize),
  hasher: new BcryptPasswordHasher(4),
  unitOfWork: uow,
  outbox,
});
const repository = new SequelizeRoleAssignmentRepository(sequelize);
const permissions = new PermissionRegistry();
permissions.register({ code: 'attendance.session.record', roles: ['TEACHER'] });
const service = new RoleService({ repository, identity, permissions, unitOfWork: uow, outbox });

const PREFIX = '+2010998';
let counter = Math.floor(Math.random() * 50000);
const newUser = async () => (await identity.createUser({ phone: `${PREFIX}${String(++counter).padStart(5, '0')}`, password: 'secret1' })).id;

const TEST_USERS = `SELECT id FROM users WHERE phone LIKE '${PREFIX}%'`;
async function cleanup() {
  await sequelize.query(
    `DELETE FROM outbox_messages WHERE aggregate_type = 'RoleAssignment'
       AND aggregate_id IN (SELECT id FROM user_roles WHERE user_id IN (${TEST_USERS}))`,
  );
  await sequelize.query(`DELETE FROM outbox_messages WHERE aggregate_type = 'User' AND aggregate_id IN (${TEST_USERS})`);
  await sequelize.query(`DELETE FROM user_roles WHERE user_id IN (${TEST_USERS})`);
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
const rowsOf = (userId: string) =>
  sequelize.query<{ id: string; role_code: string; active: number | null; revoked_at: Date | null; assigned_by: string | null; version: number }>(
    'SELECT id, role_code, active, revoked_at, assigned_by, version FROM user_roles WHERE user_id = :userId ORDER BY assigned_at, id',
    { replacements: { userId }, type: QueryTypes.SELECT },
  );

describe('user_roles (MariaDB)', () => {
  beforeAll(cleanup);
  afterAll(async () => {
    await cleanup();
    await sequelize.close();
  });

  it('stores assignments with who/when and reads them back in order', async () => {
    const admin = await newUser();
    const user = await newUser();
    await service.assignRole({ userId: user, roleCode: 'PARENT', assignedBy: admin });
    await service.assignRole({ userId: user, roleCode: 'TEACHER', assignedBy: null });

    // Rows created in the same millisecond have no guaranteed relative order, so compare sorted by role.
    const byRole = <T extends { role_code?: string; roleCode?: string }>(rows: T[]) =>
      [...rows].sort((a, b) => String(a.role_code ?? a.roleCode).localeCompare(String(b.role_code ?? b.roleCode)));
    const rows = byRole(await rowsOf(user));
    expect(rows.map((r) => [r.role_code, r.active, r.assigned_by, r.version])).toEqual([
      ['PARENT', 1, admin, 1],
      ['TEACHER', 1, null, 1],
    ]);
    expect(await service.listActiveRoles(user)).toEqual(['TEACHER', 'PARENT']);
    const history = byRole(await service.listRoleHistory(user));
    expect(history.map((h) => h.roleCode)).toEqual(['PARENT', 'TEACHER']);
    expect(history[0]!.assignedBy).toBe(admin);
    expect(history[0]!.assignedAt).toBeInstanceOf(Date);
  });

  it('keeps one ACTIVE assignment per role (service check and unique-index guard)', async () => {
    const user = await newUser();
    await service.assignRole({ userId: user, roleCode: 'TEACHER', assignedBy: null });
    expect(await codeOf(service.assignRole({ userId: user, roleCode: 'TEACHER', assignedBy: null }))).toBe('ROLE_ALREADY_ASSIGNED');

    // Race: bypass the service-level check; the unique index must still reject the duplicate.
    const clone = RoleAssignment.assign({ userId: user, roleCode: 'TEACHER', assignedBy: null, clock: new SystemClock() });
    expect(await codeOf(uow.run((tx) => repository.insert(clone, tx)))).toBe('ROLE_ALREADY_ASSIGNED');
    expect(await rowsOf(user)).toHaveLength(1);
  });

  it('keeps revoked history and allows the same role to be assigned again', async () => {
    const admin = await newUser();
    const user = await newUser();
    await service.assignRole({ userId: user, roleCode: 'PARENT', assignedBy: null });
    await service.assignRole({ userId: user, roleCode: 'TEACHER', assignedBy: null });
    await service.revokeRole({ userId: user, roleCode: 'TEACHER', revokedBy: admin });
    await service.assignRole({ userId: user, roleCode: 'TEACHER', assignedBy: admin });

    const rows = await rowsOf(user);
    const teacher = rows.filter((r) => r.role_code === 'TEACHER');
    expect(teacher).toHaveLength(2);
    expect(teacher.map((r) => r.active).sort()).toEqual([1, null].sort());
    const revoked = teacher.find((r) => r.active === null)!;
    expect(revoked.revoked_at).toBeInstanceOf(Date);
    expect(revoked.version).toBe(2);
    const dto = (await service.listRoleHistory(user)).find((h) => !h.isActive)!;
    expect(dto.revokedBy).toBe(admin);
    expect(await service.listActiveRoles(user)).toEqual(['TEACHER', 'PARENT']);
  });

  it('never leaves a user without an active role', async () => {
    const user = await newUser();
    await service.assignRole({ userId: user, roleCode: 'PARENT', assignedBy: null });
    expect(await codeOf(service.revokeRole({ userId: user, roleCode: 'PARENT', revokedBy: null }))).toBe('LAST_ACTIVE_ROLE');
    expect(await service.listActiveRoles(user)).toEqual(['PARENT']);
  });

  it('stays safe when two revocations race (exactly one succeeds, one role remains)', async () => {
    const user = await newUser();
    await service.assignRole({ userId: user, roleCode: 'PARENT', assignedBy: null });
    await service.assignRole({ userId: user, roleCode: 'TEACHER', assignedBy: null });

    const results = await Promise.allSettled([
      service.revokeRole({ userId: user, roleCode: 'PARENT', revokedBy: null }),
      service.revokeRole({ userId: user, roleCode: 'TEACHER', revokedBy: null }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect((rejected.reason as AppError).code).toBe('LAST_ACTIVE_ROLE');
    expect(await service.listActiveRoles(user)).toHaveLength(1);
  });

  it('checks permissions through active roles', async () => {
    const user = await newUser();
    await service.assignRole({ userId: user, roleCode: 'PARENT', assignedBy: null });
    expect(await service.hasPermission(user, 'attendance.session.record')).toBe(false);
    await service.assignRole({ userId: user, roleCode: 'TEACHER', assignedBy: null });
    expect(await service.hasPermission(user, 'attendance.session.record')).toBe(true);
    await service.revokeRole({ userId: user, roleCode: 'TEACHER', revokedBy: null });
    expect(await service.hasPermission(user, 'attendance.session.record')).toBe(false);
  });

  it('writes the role change and its events atomically', async () => {
    const user = await newUser();
    const a = await service.assignRole({ userId: user, roleCode: 'PARENT', assignedBy: null });
    await service.assignRole({ userId: user, roleCode: 'TEACHER', assignedBy: null });
    const t = await service.revokeRole({ userId: user, roleCode: 'TEACHER', revokedBy: null });

    const events = await sequelize.query<{ event_type: string; payload: string }>(
      `SELECT event_type, payload FROM outbox_messages WHERE aggregate_type = 'RoleAssignment'
         AND aggregate_id IN (:ids) ORDER BY id`,
      { replacements: { ids: [a.id, t.id] }, type: QueryTypes.SELECT },
    );
    expect(events.map((e) => e.event_type)).toEqual([
      RoleEventTypes.ROLE_ASSIGNED,
      RoleEventTypes.ROLE_ASSIGNED,
      RoleEventTypes.ROLE_REVOKED,
    ]);
    expect(JSON.parse(events[2]!.payload)).toEqual({ assignmentId: t.id, userId: user, roleCode: 'TEACHER' });
  });

  it('rolls back the role AND its event when the surrounding transaction fails', async () => {
    const user = await newUser();
    let assignmentId = '';
    try {
      await uow.run(async (tx) => {
        assignmentId = (await service.assignRole({ userId: user, roleCode: 'PARENT', assignedBy: null }, tx)).id;
        throw new Error('rollback');
      });
    } catch {
      /* expected */
    }
    expect(assignmentId).not.toBe('');
    expect(await rowsOf(user)).toHaveLength(0);
    const events = await sequelize.query('SELECT 1 FROM outbox_messages WHERE aggregate_id = :id', {
      replacements: { id: assignmentId },
      type: QueryTypes.SELECT,
    });
    expect(events).toHaveLength(0);
  });

  it('is protected by database constraints (role list, Student, state consistency)', async () => {
    const user = await newUser();
    const insert = (role: string, active: number | null, revokedAt: string | null) =>
      sequelize.query(
        `INSERT INTO user_roles (id, user_id, role_code, assigned_at, active, revoked_at, version, created_at, updated_at)
         VALUES (UUID(), :user, :role, NOW(3), :active, :revokedAt, 1, NOW(3), NOW(3))`,
        { replacements: { user, role, active, revokedAt } },
      );
    await expect(insert('STUDENT', 1, null)).rejects.toThrow();
    await expect(insert('SUPERVISOR', 1, null)).rejects.toThrow();
    await expect(insert('TEACHER', 1, '2026-01-01 00:00:00')).rejects.toThrow(); // active but revoked
    await expect(insert('TEACHER', null, null)).rejects.toThrow(); // inactive without revoked_at
    expect(await rowsOf(user)).toHaveLength(0);
  });
});
