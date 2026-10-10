import { registerErrorMessages } from '../../modules/03-error-localization/public';
import { VALIDATION_ERROR_MESSAGES } from '../../modules/04-validation-api/public';
import { FILE_ERROR_MESSAGES } from '../../modules/07-file-infrastructure/public';
import { IDENTITY_ERROR_MESSAGES } from '../../modules/08-identity-core/public';
import { ROLE_ERROR_MESSAGES } from '../../modules/09-roles-permissions/public';
import { SESSION_ERROR_MESSAGES } from '../../modules/10-sessions-jwt/public';
import { RECOVERY_ERROR_MESSAGES } from '../../modules/11-otp-password-recovery/public';
import { AUTHORIZATION_ERROR_MESSAGES } from '../../modules/12-authorization-engine/public';

let registered = false;

/** Registers every module's error messages once (safe to call repeatedly). */
export function registerAllErrorMessages(): void {
  if (registered) return;
  registered = true;
  registerErrorMessages(VALIDATION_ERROR_MESSAGES);
  registerErrorMessages(FILE_ERROR_MESSAGES);
  registerErrorMessages(IDENTITY_ERROR_MESSAGES);
  registerErrorMessages(ROLE_ERROR_MESSAGES);
  registerErrorMessages(SESSION_ERROR_MESSAGES);
  registerErrorMessages(RECOVERY_ERROR_MESSAGES);
  registerErrorMessages(AUTHORIZATION_ERROR_MESSAGES);
}
