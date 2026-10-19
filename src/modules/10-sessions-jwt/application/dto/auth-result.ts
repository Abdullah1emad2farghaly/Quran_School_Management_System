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
}

/** Who is making an authenticated request. */
export interface AuthPrincipal {
  readonly userId: string;
  readonly sessionId: string;
  /** Account-level requirement read from the user on every request: until the password is changed only the password change and logout work. */
  readonly mustChangePassword: boolean;
}
