import { describe, expect, it } from 'vitest';
import { AppError } from '../../../src/modules/00-shared-kernel/public';
import {
  ASSIGNABLE_ROLE_CODES,
  PermissionRegistry,
  ROLE_CATALOG,
  ROLE_CODES,
  ROLE_ERROR_MESSAGES,
  RoleErrorCodes,
  isAssignableRole,
  isPermissionCode,
  isRoleCode,
  sortRoles,
} from '../../../src/modules/09-roles-permissions/public';

const codeOf = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    if (e instanceof AppError) return e.code;
    throw e;
  }
  return 'OK';
};

describe('V1 role catalog (§18)', () => {
  it('is exactly the nine approved roles', () => {
    expect([...ROLE_CODES]).toEqual([
      'MAIN_ADMIN',
      'GOVERNORATE_MANAGER',
      'CENTER_MANAGER',
      'VILLAGE_MANAGER',
      'SCHOOL_MANAGER',
      'TEACHER',
      'STUDENT',
      'PARENT',
      'SUBSCRIPTION_COLLECTOR',
    ]);
  });

  it('has no Supervisor and no Competition Manager', () => {
    for (const forbidden of ['SUPERVISOR', 'COMPETITION_MANAGER', 'ADMIN', 'MANAGER']) {
      expect(isRoleCode(forbidden)).toBe(false);
    }
  });

  it('has Arabic and English names for every role', () => {
    expect(ROLE_CATALOG.map((r) => r.code)).toEqual([...ROLE_CODES]);
    for (const role of ROLE_CATALOG) {
      expect(role.name.ar.length).toBeGreaterThan(0);
      expect(role.name.en.length).toBeGreaterThan(0);
    }
  });

  it('does not allow a user to hold Student (no login in V1)', () => {
    expect(isAssignableRole('STUDENT')).toBe(false);
    expect(ASSIGNABLE_ROLE_CODES).not.toContain('STUDENT');
    expect(ASSIGNABLE_ROLE_CODES).toHaveLength(8);
  });

  it('rejects non-role values', () => {
    for (const v of [undefined, null, 1, {}, '', 'teacher', 'Teacher ']) expect(isRoleCode(v)).toBe(false);
  });

  it('sorts roles in catalog order without duplicates', () => {
    expect(sortRoles(['PARENT', 'TEACHER', 'PARENT', 'MAIN_ADMIN'])).toEqual(['MAIN_ADMIN', 'TEACHER', 'PARENT']);
  });
});

describe('permission codes', () => {
  it.each(['schools.school.create', 'students.student.change-status', 'reports.attendance.view.school'])('accepts %s', (code) => {
    expect(isPermissionCode(code)).toBe(true);
  });
  it.each(['', 'schools', 'schools.create', 'Schools.School.Create', 'schools.school.', '.a.b', 'a..b', 'a.b.c.d.e', 'a.b c.d', 'a.1b.c', 12])(
    'rejects %j',
    (code) => {
      expect(isPermissionCode(code)).toBe(false);
    },
  );
});

describe('PermissionRegistry', () => {
  const make = () => {
    const r = new PermissionRegistry();
    r.register({ code: 'schools.school.create', roles: ['MAIN_ADMIN', 'GOVERNORATE_MANAGER'] });
    r.register({ code: 'attendance.session.record', roles: ['TEACHER', 'SCHOOL_MANAGER'] });
    return r;
  };

  it('starts empty: nothing is granted until a module registers it', () => {
    const r = new PermissionRegistry();
    expect(r.all()).toEqual([]);
    expect(r.anyRoleHasPermission([...ROLE_CODES], 'schools.school.create')).toBe(false);
  });

  it('grants exactly the registered roles', () => {
    const r = make();
    expect(r.roleHasPermission('MAIN_ADMIN', 'schools.school.create')).toBe(true);
    expect(r.roleHasPermission('TEACHER', 'schools.school.create')).toBe(false);
    expect(r.rolesGranting('attendance.session.record')).toEqual(['SCHOOL_MANAGER', 'TEACHER']);
    expect(r.anyRoleHasPermission(['PARENT', 'TEACHER'], 'attendance.session.record')).toBe(true);
    expect(r.anyRoleHasPermission(['PARENT'], 'attendance.session.record')).toBe(false);
  });

  it('denies unknown permissions and empty role lists (deny by default)', () => {
    const r = make();
    expect(r.isRegistered('nothing.such.thing')).toBe(false);
    expect(r.roleHasPermission('MAIN_ADMIN', 'nothing.such.thing')).toBe(false);
    expect(r.anyRoleHasPermission([], 'schools.school.create')).toBe(false);
  });

  it('lists the permissions of a set of roles, sorted', () => {
    const r = make();
    expect(r.permissionsOfRoles(['TEACHER', 'MAIN_ADMIN'])).toEqual(['attendance.session.record', 'schools.school.create']);
    expect(r.permissionsOfRoles(['PARENT'])).toEqual([]);
    expect(r.all()).toEqual(['attendance.session.record', 'schools.school.create']);
  });

  it('rejects duplicates, bad codes, empty grants, Student and unknown roles', () => {
    const r = make();
    expect(codeOf(() => r.register({ code: 'schools.school.create', roles: ['TEACHER'] }))).toBe('PERMISSION_ALREADY_REGISTERED');
    expect(codeOf(() => r.register({ code: 'bad code', roles: ['TEACHER'] }))).toBe('INVALID_PERMISSION_CODE');
    expect(codeOf(() => r.register({ code: 'a.b.c', roles: [] }))).toBe('INVALID_PERMISSION_GRANT');
    expect(codeOf(() => r.register({ code: 'a.b.c', roles: ['STUDENT'] }))).toBe('INVALID_PERMISSION_GRANT');
    expect(codeOf(() => r.register({ code: 'a.b.c', roles: ['SUPERVISOR' as never] }))).toBe('INVALID_PERMISSION_GRANT');
    expect(r.isRegistered('a.b.c')).toBe(false);
  });

  it('does not let callers change a grant after registration', () => {
    const r = make();
    r.rolesGranting('schools.school.create').push('PARENT');
    expect(r.roleHasPermission('PARENT', 'schools.school.create')).toBe(false);
  });
});

describe('role error messages', () => {
  it('has Arabic and English text for every user-facing role error', () => {
    const userFacing = Object.values(RoleErrorCodes).filter(
      (c) => !['INVALID_PERMISSION_CODE', 'PERMISSION_ALREADY_REGISTERED', 'INVALID_PERMISSION_GRANT'].includes(c),
    );
    for (const code of userFacing) {
      const entry = ROLE_ERROR_MESSAGES.find((m) => m.code === code);
      expect(entry, code).toBeDefined();
      expect(entry!.message.ar.length).toBeGreaterThan(0);
      expect(entry!.message.en.length).toBeGreaterThan(0);
    }
  });
});
