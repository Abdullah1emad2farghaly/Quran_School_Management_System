import type { RoleCode } from '../../../09-roles-permissions/public';

export interface AuthResult {
  readonly tokenType: 'Bearer';
  readonly accessToken: string;
  readonly accessTokenExpiresAt: Date;
  readonly refreshToken: string;
  readonly refreshTokenExpiresAt: Date;
  readonly user: { readonly id: string; readonly phone: string };
  /** True while the account still has an initial password that must be changed (the backend blocks everything else until then). */
  readonly mustChangePassword: boolean;
  /** Informational (for the client UI). Authorization is always decided on the backend. */
  readonly roles: readonly RoleCode[];
  /** The role THIS session acts as: the only role of a single-role account, the one chosen with `switch-role`, or null while a multi-role account has not chosen. */
  readonly activeRole: RoleCode | null;
  /** The school the user works in as School Manager (active manager link), or null for every other account. Informational, for the client UI. */
  readonly schoolId: string | null;
}

/** Who is making an authenticated request. */
export interface AuthPrincipal {
  readonly userId: string;
  readonly sessionId: string;
  /** Account-level requirement read from the user on every request: until the password is changed only the password change and logout work. */
  readonly mustChangePassword: boolean;
  /** The role this session currently acts as (derived from the persisted session and the CURRENT role assignments), or null when none is selected. */
  readonly activeRole: RoleCode | null;
}

/** The authentication context returned by `switch-role`. */
export interface ActiveRoleResult {
  readonly roles: readonly RoleCode[];
  readonly activeRole: RoleCode | null;
  readonly schoolId: string | null;
}
