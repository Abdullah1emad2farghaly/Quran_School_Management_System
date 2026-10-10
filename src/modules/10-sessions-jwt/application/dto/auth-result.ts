import type { RoleCode } from '../../../09-roles-permissions/public';

export interface AuthResult {
  readonly tokenType: 'Bearer';
  readonly accessToken: string;
  readonly accessTokenExpiresAt: Date;
  readonly refreshToken: string;
  readonly refreshTokenExpiresAt: Date;
  readonly user: { readonly id: string; readonly phone: string };
  /** Informational (for the client UI). Authorization is always decided on the backend. */
  readonly roles: readonly RoleCode[];
}

/** Who is making an authenticated request. */
export interface AuthPrincipal {
  readonly userId: string;
  readonly sessionId: string;
}
