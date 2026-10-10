import { roleError } from '../errors/role-errors';

/**
 * A permission code is `<module>.<resource>.<action>` (3 to 4 lowercase dot-separated parts,
 * hyphens allowed inside a part), e.g. `schools.school.create`. The owning module defines its
 * permissions; Module 09 only stores the role -> permission grants it is given.
 */
const PERMISSION_CODE = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*){2,3}$/;

export function isPermissionCode(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 100 && PERMISSION_CODE.test(value);
}

export function assertPermissionCode(value: unknown): asserts value is string {
  if (!isPermissionCode(value)) throw roleError('INVALID_PERMISSION_CODE');
}
