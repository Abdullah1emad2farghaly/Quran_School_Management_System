import { ROLE_CODES } from '../../../09-roles-permissions/public';
import { authenticatedOnly, publicEndpoint, ref, schema as s, type ModuleApiDoc } from '../../../04-validation-api/public';

const ACCESS_TOKEN_EXAMPLE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIzZjZiMWQ1Mi04YTRlLTRjMWItOWQ3Ny0yYjZmMGM5YTFlMTAifQ.c2lnbmF0dXJlLWV4YW1wbGU';

const authTokens = s.object(
  {
    tokenType: s.string({ enum: ['Bearer'], description: 'Always "Bearer": send the access token as `Authorization: Bearer <accessToken>`.' }),
    accessToken: s.string({ description: 'Short-lived JWT access token.' }),
    accessTokenExpiresAt: s.dateTime(),
    refreshToken: s.string({ description: 'Opaque, single-use refresh token. Every refresh rotates it.' }),
    refreshTokenExpiresAt: s.dateTime(),
    user: s.object({ id: s.uuid(), phone: s.string({ description: 'The normalized phone number (the login identifier).' }) }, ['id', 'phone']),
    mustChangePassword: s.boolean({ description: 'True while the account still has an initial password that must be changed. The backend then answers every protected request except `POST /auth/change-password`, `POST /auth/logout` and `POST /auth/logout-all` with 403 `PASSWORD_CHANGE_REQUIRED`.', example: false }),
    roles: s.array(s.string({ enum: ROLE_CODES }), { description: 'Informational, for the client UI. Authorization is always decided by the backend.' }),
    activeRole: s.string({ nullable: true, maxLength: 32, description: 'The role THIS session acts as. Set automatically when the account has exactly one role; NULL for an account with several roles until it chooses with `POST /auth/switch-role` (business endpoints answer 403 until then). Belongs to the session: the same account can act as different roles on different devices. Survives token refresh.', example: 'MAIN_ADMIN' }),
    schoolId: s.uuid({ nullable: true, description: 'The school the user works in as School Manager (their active manager link). Null for every other account. Informational, for the client UI; authorization is always decided by the backend.' }),
  },
  ['tokenType', 'accessToken', 'accessTokenExpiresAt', 'refreshToken', 'refreshTokenExpiresAt', 'user', 'mustChangePassword', 'roles', 'activeRole', 'schoolId'],
);

const deviceSession = s.object(
  {
    id: s.uuid({ description: 'The session id (use it to revoke this session). It is NOT a token.' }),
    deviceLabel: s.string({ nullable: true, maxLength: 100, description: 'A coarse description derived from the User-Agent at login, for example "Chrome on Android". Never the raw header, an IP address or a token. Null for a session created before this feature.', example: 'Chrome on Android' }),
    createdAt: s.dateTime({ description: 'When the session was started (the login time).' }),
    lastActiveAt: s.dateTime({ description: 'When the session\'s tokens were last issued (login or refresh). The server does not track per-request activity.' }),
    expiresAt: s.dateTime({ description: 'When the session ends if it is not refreshed: 30 days after its last refresh.' }),
    isCurrent: s.boolean({ description: 'True for the session that made this request.', example: true }),
  },
  ['id', 'deviceLabel', 'createdAt', 'lastActiveAt', 'expiresAt', 'isCurrent'],
);
const deviceSessionList = s.object(
  {
    maxActiveSessions: s.integer({ description: 'The limit of active sessions per account (3, every role).', example: 3 }),
    items: s.array(ref('DeviceSession'), { description: 'The caller\'s active sessions, oldest first.' }),
  },
  ['maxActiveSessions', 'items'],
);
const devicesExample = {
  maxActiveSessions: 3,
  items: [
    { id: '8c1f3d2e-5b6a-4f7c-9d10-3e4a5b6c7d81', deviceLabel: 'Chrome on Android', createdAt: '2026-10-15T09:30:00.000Z', lastActiveAt: '2026-10-20T07:12:00.000Z', expiresAt: '2026-11-19T07:12:00.000Z', isCurrent: true },
    { id: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d', deviceLabel: 'Safari on iOS', createdAt: '2026-10-18T18:02:00.000Z', lastActiveAt: '2026-10-18T18:02:00.000Z', expiresAt: '2026-11-17T18:02:00.000Z', isCurrent: false },
  ],
};
const SESSION_ID_PARAM = { sessionId: { description: 'The id of one of the caller\'s active sessions (from `GET /auth/sessions`).', example: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d', schema: s.uuid() } };

const tokensExample = {
  tokenType: 'Bearer',
  accessToken: ACCESS_TOKEN_EXAMPLE,
  accessTokenExpiresAt: '2026-10-15T09:45:00.000Z',
  refreshToken: 'q7Zk2n0b6mXx3Yd8u5Vf1T4hLwEoPaRcGsJiKtNyMlA',
  refreshTokenExpiresAt: '2026-11-14T09:30:00.000Z',
  user: { id: '3f6b1d52-8a4e-4c1b-9d77-2b6f0c9a1e10', phone: '+201001234567' },
  mustChangePassword: false,
  roles: ['MAIN_ADMIN'],
  activeRole: 'MAIN_ADMIN',
  schoolId: null,
};
const activeRoleResult = s.object(
  {
    roles: s.array(s.string({ maxLength: 32 }), { description: 'Every role the account currently holds (from the real role assignments).' }),
    activeRole: s.string({ maxLength: 32, description: 'The role this session now acts as.', example: 'TEACHER' }),
    schoolId: s.uuid({ nullable: true, description: 'The school the user works in as School Manager, or null.' }),
  },
  ['roles', 'activeRole', 'schoolId'],
);
const switchRoleExample = { roles: ['TEACHER', 'PARENT'], activeRole: 'PARENT', schoolId: null };

/** OpenAPI contract of `/auth` (`auth.routes.ts`). Module 10: sessions and JWT. */
export const authApiDoc: ModuleApiDoc = {
  moduleId: '10',
  mountPath: '/auth',
  tag: { name: 'Authentication', description: 'Login, token refresh, logout and "My devices". Up to 3 devices (sessions) per account, every role. Start here: log in, then use "Authorize" with the access token.' },
  operations: [
    {
      method: 'post',
      path: '/login',
      operationId: 'login',
      summary: 'Log in with phone and password',
      description:
        'Authenticates a user by phone number and password and starts a NEW session in its own slot; no existing session is ever revoked or replaced. An account may have up to 3 active sessions (every role): when all 3 are in use the login is refused with `SESSION_LIMIT_REACHED` and the user must log out of one device first. That answer is given only AFTER the password was verified, so it discloses nothing to someone who does not know the password. Sessions whose refresh token expired no longer count. The answer is the same `INVALID_CREDENTIALS` whether the phone is unknown, malformed or the password is wrong (no account enumeration). Token answers are sent with `Cache-Control: no-store`.',
      authorization: publicEndpoint('Public endpoint: this IS the authentication.'),
      request: {
        description: 'The phone number (any accepted format) and the password.',
        schema: s.object(
          {
            phone: s.string({ maxLength: 40, description: 'The phone number; it is normalized before use.', example: '+201001234567' }),
            password: s.string({ maxLength: 128, example: 'S3cure-Passw0rd' }),
          },
          ['phone', 'password'],
        ),
        examples: { login: { summary: 'A valid login', value: { phone: '+201001234567', password: 'S3cure-Passw0rd' } } },
      },
      success: { status: 200, description: 'The session was started.', data: ref('AuthTokens'), example: tokensExample, noStore: true },
      errors: [
        { status: 401, codes: ['INVALID_CREDENTIALS'], description: 'Wrong phone or password.' },
        { status: 403, codes: ['ACCOUNT_INACTIVE'], description: 'The credentials are right but the account is deactivated.' },
        { status: 409, codes: ['SESSION_CONCURRENT_MODIFICATION'], description: 'A concurrent session update could not be resolved; retry.' },
        { status: 422, codes: ['SESSION_LIMIT_REACHED'], description: 'The credentials are right but the account already has 3 active sessions. `details.maxActiveSessions` is 3. Nothing was revoked: the user must log out of one existing device (or revoke one from "My devices") and log in again.' },
      ],
    },
    {
      method: 'post',
      path: '/refresh',
      operationId: 'refreshTokens',
      summary: 'Exchange a refresh token for new tokens',
      description:
        'Rotates ONE session (other sessions are unaffected): the refresh token is single-use and the answer carries a NEW access token AND a NEW refresh token. Presenting an already used refresh token is treated as theft and revokes that session only (`REFRESH_TOKEN_REUSED`).',
      authorization: publicEndpoint('Public endpoint: the refresh token itself is the credential.'),
      request: {
        description: 'The current refresh token.',
        schema: s.object({ refreshToken: s.string({ maxLength: 200, example: 'q7Zk2n0b6mXx3Yd8u5Vf1T4hLwEoPaRcGsJiKtNyMlA' }) }, ['refreshToken']),
        examples: { refresh: { summary: 'Refresh a session', value: { refreshToken: 'q7Zk2n0b6mXx3Yd8u5Vf1T4hLwEoPaRcGsJiKtNyMlA' } } },
      },
      success: { status: 200, description: 'New tokens were issued.', data: ref('AuthTokens'), example: tokensExample, noStore: true },
      errors: [
        { status: 401, codes: ['REFRESH_TOKEN_INVALID', 'REFRESH_TOKEN_EXPIRED', 'REFRESH_TOKEN_REUSED'], description: 'The refresh token is not usable.' },
        { status: 403, codes: ['ACCOUNT_INACTIVE'], description: 'The account was deactivated.' },
        { status: 409, codes: ['SESSION_CONCURRENT_MODIFICATION'], description: 'A concurrent session update could not be resolved; retry.' },
      ],
    },
    {
      method: 'post',
      path: '/switch-role',
      operationId: 'switchRole',
      summary: 'Choose the role this session acts as',
      description:
        'An account may hold several roles. The ACTIVE ROLE belongs to the SESSION (device), not to the account: this call changes the active role of the session the access token belongs to and NOTHING else. Other sessions of the account keep their own active roles, none is revoked and no token is rotated; it is not a new login and does not count towards the 3-session limit. The requested role is checked against the account\'s CURRENT role assignments in the database (a role that was never assigned or was revoked is refused). Every protected business endpoint authorizes only through the active role of the calling session, read on every request, so the previous role stops working immediately and an old access token cannot keep acting as it. Choosing the role that is already active is a safe no-op. Role codes are the platform\'s role codes (for example `TEACHER`, `PARENT`, `SCHOOL_MANAGER`, `ORGANIZATION_MANAGER`). Reachable while no role is selected (that is its purpose).',
      authorization: authenticatedOnly('The caller\'s own current session.', 'Authentication only: the account and session come from the verified access token; the role is validated against the account\'s real assignments.'),
      request: {
        description: 'The role to act as.',
        schema: s.object({ role: s.string({ maxLength: 32, description: 'A role code the account currently holds.', example: 'PARENT' }) }, ['role']),
        examples: { switch: { summary: 'Act as a parent', value: { role: 'PARENT' } } },
      },
      success: { status: 200, description: 'The session now acts as this role.', data: ref('ActiveRoleResult'), example: switchRoleExample, noStore: true },
      errors: [
        { status: 400, codes: ['VALIDATION_FAILED'], description: 'The role is missing or malformed.' },
        { status: 401, codes: ['SESSION_REVOKED'], description: 'The session was revoked or its refresh token expired.' },
        { status: 403, codes: ['ROLE_NOT_ASSIGNED', 'PASSWORD_CHANGE_REQUIRED'], description: 'The account does not hold this role (never assigned or revoked), or it must first change its initial password.' },
      ],
    },
    {
      method: 'post',
      path: '/logout',
      operationId: 'logout',
      summary: 'Log out the current session',
      description: 'Revokes ONLY the session the access token belongs to (reason `LOGOUT`) and frees its slot. The account\'s other sessions stay valid. Publishes `AuthSessionRevoked`.',
      authorization: authenticatedOnly('The caller\'s own current session.', 'Authentication only: the session comes from the verified access token.'),
      success: { status: 204, description: 'The session was revoked. No content.' },
    },
    {
      method: 'post',
      path: '/change-password',
      operationId: 'changePassword',
      summary: 'Change the caller\'s own password',
      description:
        'The authenticated user changes their own password: the current password must be right, the new one must follow the password policy (4-12 characters, no composition rule) and differ from the current one. A successful change also revokes EVERY OTHER active session of the account (reason `PASSWORD_CHANGED`, one `AuthSessionRevoked` each); the session that made the change stays active and no token is reissued. A successful change clears the account\'s mandatory first-login password change (the initial password of a new Parent account is the last four digits of the phone). This is the only authenticated operation besides the logouts that works while the change is still pending. The current session stays valid; no new tokens are issued.',
      authorization: authenticatedOnly("The caller's own account.", 'Authentication only: the user comes from the verified access token. Reachable while the account must still change its initial password.'),
      request: {
        description: 'The current password and the new password.',
        schema: s.object(
          {
            currentPassword: s.string({ maxLength: 128, example: '4567' }),
            newPassword: s.string({ maxLength: 128, description: '4-12 characters; must differ from the current password.', example: 'My-New-Pass1' }),
          },
          ['currentPassword', 'newPassword'],
        ),
        examples: { change: { summary: 'Replace the initial password', value: { currentPassword: '4567', newPassword: 'My-New-Pass1' } } },
      },
      success: { status: 204, description: 'The password was changed and the requirement (if any) cleared. No content.', noStore: true },
      errors: [
        { status: 400, codes: ['INVALID_PASSWORD', 'CURRENT_PASSWORD_INCORRECT'], description: 'The new password breaks the policy, or the current password is wrong.' },
        { status: 422, codes: ['NEW_PASSWORD_SAME_AS_CURRENT'], description: 'The new password equals the current one.' },
      ],
    },
    {
      method: 'post',
      path: '/logout-all',
      operationId: 'logoutAll',
      summary: 'Log out every session of the current user',
      description: 'Revokes all sessions (up to 3) of the user the access token belongs to, including the current one (reason `LOGOUT_ALL`).',
      authorization: authenticatedOnly('All sessions of the caller.', 'Authentication only: the user comes from the verified access token.'),
      success: { status: 204, description: 'All sessions were revoked. No content.' },
    },
    {
      method: 'get',
      path: '/sessions',
      operationId: 'listMyDevices',
      summary: 'My devices: list the caller\'s active sessions',
      description:
        'Lists the caller\'s own active, unexpired sessions (at most 3), oldest first, with safe device information. The account always comes from the verified access token. Never returns any token, token hash or secret. Sent with `Cache-Control: no-store`.',
      authorization: authenticatedOnly('The caller\'s own sessions.', 'Authentication only: the user comes from the verified access token; no other account\'s sessions can be listed.'),
      success: { status: 200, description: 'The active sessions.', data: ref('DeviceSessionList'), example: devicesExample, noStore: true },
      errors: [{ status: 403, codes: ['PASSWORD_CHANGE_REQUIRED'], description: 'The account must first change its initial password.' }],
    },
    {
      method: 'delete',
      path: '/sessions/:sessionId',
      operationId: 'revokeMyDevice',
      summary: 'My devices: revoke one session',
      description:
        'Revokes ONE selected active session of the caller\'s account (reason `DEVICE_REVOKED`; `LOGOUT` when it is the caller\'s own session) and frees its slot. All other sessions stay active. Publishes `AuthSessionRevoked`. A session that does not exist, belongs to another account or has already ended answers the same `SESSION_NOT_FOUND`, so other accounts\' ids cannot be probed.',
      authorization: authenticatedOnly('One of the caller\'s own sessions.', 'Authentication plus ownership: the session must belong to the caller\'s account (checked server-side).'),
      pathParams: SESSION_ID_PARAM,
      success: { status: 204, description: 'The session was revoked. No content.', noStore: true },
      errors: [
        { status: 403, codes: ['PASSWORD_CHANGE_REQUIRED'], description: 'The account must first change its initial password.' },
        { status: 404, codes: ['SESSION_NOT_FOUND'], description: 'No active session of the caller\'s account has this id.' },
      ],
    },
  ],
  schemas: { AuthTokens: authTokens, ActiveRoleResult: activeRoleResult, DeviceSession: deviceSession, DeviceSessionList: deviceSessionList },
};
