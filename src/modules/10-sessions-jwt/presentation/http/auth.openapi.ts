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
    roles: s.array(s.string({ enum: ROLE_CODES }), { description: 'Informational, for the client UI. Authorization is always decided by the backend.' }),
  },
  ['tokenType', 'accessToken', 'accessTokenExpiresAt', 'refreshToken', 'refreshTokenExpiresAt', 'user', 'roles'],
);

const tokensExample = {
  tokenType: 'Bearer',
  accessToken: ACCESS_TOKEN_EXAMPLE,
  accessTokenExpiresAt: '2026-10-15T09:45:00.000Z',
  refreshToken: 'q7Zk2n0b6mXx3Yd8u5Vf1T4hLwEoPaRcGsJiKtNyMlA',
  refreshTokenExpiresAt: '2026-11-14T09:30:00.000Z',
  user: { id: '3f6b1d52-8a4e-4c1b-9d77-2b6f0c9a1e10', phone: '+201001234567' },
  roles: ['MAIN_ADMIN'],
};

/** OpenAPI contract of `/auth` (`auth.routes.ts`). Module 10: sessions and JWT. */
export const authApiDoc: ModuleApiDoc = {
  moduleId: '10',
  mountPath: '/auth',
  tag: { name: 'Authentication', description: 'Login, token refresh and logout. Start here: log in, then use "Authorize" with the access token.' },
  operations: [
    {
      method: 'post',
      path: '/login',
      operationId: 'login',
      summary: 'Log in with phone and password',
      description:
        'Authenticates a user by phone number and password and starts a session. The answer is the same `INVALID_CREDENTIALS` whether the phone is unknown, malformed or the password is wrong (no account enumeration). Token answers are sent with `Cache-Control: no-store`.',
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
      ],
    },
    {
      method: 'post',
      path: '/refresh',
      operationId: 'refreshTokens',
      summary: 'Exchange a refresh token for new tokens',
      description:
        'Rotates the session: the refresh token is single-use and the answer carries a NEW access token AND a NEW refresh token. Presenting an already used refresh token is treated as theft and revokes the session (`REFRESH_TOKEN_REUSED`).',
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
      path: '/logout',
      operationId: 'logout',
      summary: 'Log out the current session',
      description: 'Revokes the session the access token belongs to. Other sessions of the same user stay valid.',
      authorization: authenticatedOnly('The caller\'s own current session.', 'Authentication only: the session comes from the verified access token.'),
      success: { status: 204, description: 'The session was revoked. No content.' },
    },
    {
      method: 'post',
      path: '/logout-all',
      operationId: 'logoutAll',
      summary: 'Log out every session of the current user',
      description: 'Revokes all sessions of the user the access token belongs to.',
      authorization: authenticatedOnly('All sessions of the caller.', 'Authentication only: the user comes from the verified access token.'),
      success: { status: 204, description: 'All sessions were revoked. No content.' },
    },
  ],
  schemas: { AuthTokens: authTokens },
};
