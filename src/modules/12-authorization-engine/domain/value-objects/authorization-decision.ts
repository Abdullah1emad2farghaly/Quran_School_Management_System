import type { RoleCode } from '../../../09-roles-permissions/public';

/** Why access was denied. For logs and tests only: it is never sent to API clients. */
export const DENY_REASONS = [
  'INVALID_REQUEST',
  'PERMISSION_NOT_REGISTERED',
  'USER_NOT_FOUND',
  'USER_INACTIVE',
  'NO_ACTIVE_ROLE',
  'PERMISSION_NOT_GRANTED',
  'SCOPE_RESOLVER_MISSING',
  'SCOPE_NOT_COVERED',
  'SCOPE_RESOLUTION_FAILED',
  'OWNERSHIP_RESOURCE_MISSING',
  'OWNERSHIP_RESOLVER_MISSING',
  'OWNERSHIP_NOT_SATISFIED',
  'OWNERSHIP_RESOLUTION_FAILED',
] as const;
export type DenyReason = (typeof DENY_REASONS)[number];

export type AuthorizationDecision =
  | { readonly allowed: true; /** The active role through which the action was authorized. */ readonly role: RoleCode }
  | { readonly allowed: false; readonly reason: DenyReason };

export const deny = (reason: DenyReason): AuthorizationDecision => ({ allowed: false, reason });
export const allow = (role: RoleCode): AuthorizationDecision => ({ allowed: true, role });
