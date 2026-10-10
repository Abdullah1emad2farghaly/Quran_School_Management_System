import { describe, expect, it } from 'vitest';
import { AppError } from '../../../src/modules/00-shared-kernel/public';
import { BootstrapMainAdmin } from '../../../src/modules/12-authorization-engine/public';
import { createAuthorizationHarness } from '../../helpers/authorization-harness';

function setup() {
  const h = createAuthorizationHarness();
  const bootstrap = new BootstrapMainAdmin({ identity: h.identity, roles: h.roles, guard: h.guard, unitOfWork: h.unitOfWork, clock: h.clock });
  return { h, bootstrap };
}
const codeOf = async (p: Promise<unknown>) => (await p.then(() => 'NO_ERROR', (e: unknown) => (e instanceof AppError ? e.code : 'NOT_APP_ERROR')));

describe('BootstrapMainAdmin', () => {
  it('creates an active user with the MAIN_ADMIN role, assigned by the system', async () => {
    const { h, bootstrap } = setup();
    const { userId } = await bootstrap.execute({ phone: '010 1234 5678', password: 'Adm1n-pw' });

    const user = await h.identity.findById(userId);
    expect(user).toMatchObject({ phone: '+201012345678', isActive: true }); // existing phone normalization applied
    expect(await h.roles.listActiveRoles(userId)).toEqual(['MAIN_ADMIN']);
    expect((await h.roles.listRoleHistory(userId))[0]).toMatchObject({ roleCode: 'MAIN_ADMIN', assignedBy: null });
    expect(h.guard.lockCalls).toBe(1);
    expect(h.guard.recorded).toEqual([{ userId, at: h.clock.now() }]);
  });

  it('stores only a hash: the password verifies but the stored value is not the plain text', async () => {
    const { h, bootstrap } = setup();
    const { userId } = await bootstrap.execute({ phone: '01012345678', password: 'Adm1n-pw' });
    expect(await h.identity.verifyPassword(userId, 'Adm1n-pw')).toBe(true);
    expect(await h.identity.verifyPassword(userId, 'wrong')).toBe(false);
    expect(JSON.stringify(h.outbox)).not.toContain('Adm1n-pw');
  });

  it('refuses a second initial Main Admin, whatever the phone', async () => {
    const { bootstrap, h } = setup();
    await bootstrap.execute({ phone: '01012345678', password: 'Adm1n-pw' });
    expect(await codeOf(bootstrap.execute({ phone: '01087654321', password: 'Adm1n-pw' }))).toBe('MAIN_ADMIN_ALREADY_EXISTS');
    expect(await h.roles.countActiveByRole('MAIN_ADMIN')).toBe(1);
    expect(await h.identity.findByPhone('01087654321')).toBeUndefined();
  });

  it('refuses when an active Main Admin exists even if it was created another way', async () => {
    const { bootstrap, h } = setup();
    await h.createUser('MAIN_ADMIN');
    expect(await codeOf(bootstrap.execute({ phone: '01087654321', password: 'Adm1n-pw' }))).toBe('MAIN_ADMIN_ALREADY_EXISTS');
  });

  it('allows a new bootstrap when the only Main Admin role was revoked (no ACTIVE Main Admin remains)', async () => {
    const { bootstrap, h } = setup();
    const u = await h.createUser('MAIN_ADMIN', 'PARENT');
    await h.roles.revokeRole({ userId: u.id, roleCode: 'MAIN_ADMIN', revokedBy: null });
    await expect(bootstrap.execute({ phone: '01087654321', password: 'Adm1n-pw' })).resolves.toHaveProperty('userId');
  });

  it('never merges into an existing user: a taken phone is a conflict', async () => {
    const { bootstrap, h } = setup();
    const existing = await h.createUser('PARENT');
    expect(await codeOf(bootstrap.execute({ phone: existing.phone, password: 'Adm1n-pw' }))).toBe('USER_PHONE_ALREADY_EXISTS');
    expect(await h.roles.countActiveByRole('MAIN_ADMIN')).toBe(0);
  });

  it('applies the existing phone and password rules', async () => {
    const { bootstrap, h } = setup();
    expect(await codeOf(bootstrap.execute({ phone: 'not-a-phone', password: 'Adm1n-pw' }))).not.toBe('NO_ERROR');
    expect(await codeOf(bootstrap.execute({ phone: '01012345678', password: '123' }))).not.toBe('NO_ERROR'); // shorter than 4
    expect(await h.roles.countActiveByRole('MAIN_ADMIN')).toBe(0);
  });
});

describe('RoleService.countActiveByRole (Module 09 addition)', () => {
  it('counts only ACTIVE assignments of that role across users', async () => {
    const h = createAuthorizationHarness();
    const a = await h.createUser('MAIN_ADMIN', 'PARENT');
    await h.createUser('MAIN_ADMIN');
    await h.createUser('TEACHER');
    expect(await h.roles.countActiveByRole('MAIN_ADMIN')).toBe(2);
    await h.roles.revokeRole({ userId: a.id, roleCode: 'MAIN_ADMIN', revokedBy: null });
    expect(await h.roles.countActiveByRole('MAIN_ADMIN')).toBe(1);
    expect(await h.roles.countActiveByRole('TEACHER')).toBe(1);
    expect(await h.roles.countActiveByRole('COLLECTOR' as never).catch((e: AppError) => e.code)).toBe('INVALID_ROLE');
  });
});
