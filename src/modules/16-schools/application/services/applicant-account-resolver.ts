import type { TransactionContext } from '../../../00-shared-kernel/public';
import type { IdentityService } from '../../../08-identity-core/public';
import { schoolError } from '../../domain/errors/school-errors';

/**
 * Applicant identity for a public submission (organization registration and Sub-School requests). Shared by both.
 * - Logged in (a valid access token was presented): the applicant is THAT user; it must be ACTIVE and the submitted phone must
 *   be its own (SCHOOL_APPLICANT_IDENTITY_MISMATCH). The authenticated session is the proof of identity.
 * - Not logged in: a NEW account through IAM `createUser`. Organization registration and school requests pass the password the applicant chose
 *   (IAM enforces the password policy: INVALID_PASSWORD). School requests do the same. A phone that already has an account is the IAM conflict
 *   USER_PHONE_ALREADY_EXISTS: an account is never reused, merged or claimed because a phone number was typed.
 *   A password sent by a logged-in applicant is ignored: the account already exists.
 */
export class ApplicantAccountResolver {
  constructor(
    private readonly identity: Pick<IdentityService, 'findById' | 'createUser'>,
    private readonly generatePassword?: () => string,
  ) {}

  /**
   * @param chosenPassword the password the applicant typed; `undefined` for flows without a password field. When `passwordRequired`
   *   is true (organization registration) a missing or invalid password is rejected by IAM instead of being generated.
   */
  async resolve(
    phone: string,
    authenticatedUserId: string | undefined,
    t: TransactionContext,
    chosenPassword?: unknown,
    passwordRequired = false,
  ): Promise<{ userId: string; accountCreated: boolean }> {
    if (authenticatedUserId !== undefined) {
      const user = await this.identity.findById(authenticatedUserId, t);
      if (!user || !user.isActive) throw schoolError('SCHOOL_MANAGER_NOT_ELIGIBLE');
      if (user.phone !== phone) throw schoolError('SCHOOL_APPLICANT_IDENTITY_MISMATCH');
      return { userId: user.id, accountCreated: false };
    }
    if (passwordRequired) {
      const created = await this.identity.createUser({ phone, password: chosenPassword as string }, t);
      return { userId: created.id, accountCreated: true };
    }
    if (!this.generatePassword) throw new Error('generateApplicantPassword is not configured');
    const user = await this.identity.createUser({ phone, password: this.generatePassword() }, t);
    return { userId: user.id, accountCreated: true };
  }
}
