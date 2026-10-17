import { publicEndpoint, schema as s, type ModuleApiDoc } from '../../../04-validation-api/public';

const PHONE_EXAMPLE = '+201001234567';

/** OpenAPI contract of `/auth/password-recovery` (`recovery.routes.ts`). Module 11: OTP and password recovery. */
export const recoveryApiDoc: ModuleApiDoc = {
  moduleId: '11',
  mountPath: '/auth/password-recovery',
  tag: { name: 'Password recovery', description: 'Three public steps: request an OTP, verify it for a reset token, then set a new password.' },
  operations: [
    {
      method: 'post',
      path: '/request',
      operationId: 'requestPasswordRecovery',
      summary: 'Request a password-recovery OTP',
      description:
        'Sends a one-time password to the phone when it belongs to an account. The answer is ALWAYS the same 200 (even for unknown or invalid-looking phones) so accounts cannot be enumerated. Per-phone and per-client-IP limits apply and answer 429 with a `Retry-After` header.',
      authorization: publicEndpoint('Public endpoint: protected by per-phone and per-IP rate limits.'),
      request: {
        description: 'The phone number of the account.',
        schema: s.object({ phone: s.string({ maxLength: 40, example: PHONE_EXAMPLE }) }, ['phone']),
        examples: { request: { summary: 'Request an OTP', value: { phone: PHONE_EXAMPLE } } },
      },
      success: {
        status: 200,
        description: 'The request was accepted (whether or not an account exists).',
        data: s.object({ expiresInSeconds: s.integer({ minimum: 1, description: 'How long the OTP stays valid.' }) }, ['expiresInSeconds']),
        example: { expiresInSeconds: 300 },
        noStore: true,
      },
      errors: [{ status: 429, codes: ['RATE_LIMITED'], description: 'Too many requests; wait `Retry-After` seconds.' }],
    },
    {
      method: 'post',
      path: '/verify',
      operationId: 'verifyPasswordRecoveryOtp',
      summary: 'Verify the OTP and get a reset token',
      description:
        'Exchanges a valid OTP for a short-lived, single-use reset token. A wrong, expired, used or locked OTP and an unknown account all answer the same `OTP_INVALID`.',
      authorization: publicEndpoint('Public endpoint: the OTP is the credential; failed attempts are limited.'),
      request: {
        description: 'The phone number and the OTP received.',
        schema: s.object({ phone: s.string({ maxLength: 40, example: PHONE_EXAMPLE }), otp: s.string({ maxLength: 32, example: '482913' }) }, ['phone', 'otp']),
        examples: { verify: { summary: 'Verify an OTP', value: { phone: PHONE_EXAMPLE, otp: '482913' } } },
      },
      success: {
        status: 200,
        description: 'The OTP is valid.',
        data: s.object({ resetToken: s.string({ description: 'Single-use token for the reset step.' }), resetTokenExpiresAt: s.dateTime() }, ['resetToken', 'resetTokenExpiresAt']),
        example: { resetToken: 'rT-9f2c1d7e4b6a40a1b3c5d8e0f2a4b6c8', resetTokenExpiresAt: '2026-10-15T09:40:00.000Z' },
        noStore: true,
      },
      errors: [
        { status: 400, codes: ['OTP_INVALID'], description: 'The OTP is wrong, expired, already used, locked, or the account does not exist.' },
        { status: 409, codes: ['RECOVERY_CONCURRENT_MODIFICATION'], description: 'A concurrent update could not be resolved; retry.' },
      ],
    },
    {
      method: 'post',
      path: '/reset',
      operationId: 'resetPassword',
      summary: 'Set a new password with a reset token',
      description:
        'Sets the new password (it must satisfy the password policy of 4 to 12 characters) and revokes every session of the user, so they must log in again. The reset token is single-use.',
      authorization: publicEndpoint('Public endpoint: the single-use reset token is the credential.'),
      request: {
        description: 'The reset token and the new password.',
        schema: s.object(
          {
            resetToken: s.string({ maxLength: 200, example: 'rT-9f2c1d7e4b6a40a1b3c5d8e0f2a4b6c8' }),
            newPassword: s.string({ maxLength: 128, description: 'Must satisfy the password policy: 4 to 12 characters (`INVALID_PASSWORD` otherwise; a rejected password does not use up the reset token).', example: 'N3w-Pass9' }),
          },
          ['resetToken', 'newPassword'],
        ),
        examples: { reset: { summary: 'Reset a password', value: { resetToken: 'rT-9f2c1d7e4b6a40a1b3c5d8e0f2a4b6c8', newPassword: 'N3w-Pass9' } } },
      },
      success: { status: 204, description: 'The password was changed and all sessions were revoked. No content.', noStore: true },
      errors: [
        { status: 400, codes: ['RESET_TOKEN_INVALID', 'INVALID_PASSWORD'], description: 'The reset token is unusable, or the new password does not satisfy the policy.' },
        { status: 409, codes: ['RECOVERY_CONCURRENT_MODIFICATION'], description: 'A concurrent update could not be resolved; retry.' },
      ],
    },
  ],
};
