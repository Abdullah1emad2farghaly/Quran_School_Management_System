import { registerErrorMessages } from '../../modules/03-error-localization/public';
import { VALIDATION_ERROR_MESSAGES } from '../../modules/04-validation-api/public';
import { FILE_ERROR_MESSAGES } from '../../modules/07-file-infrastructure/public';
import { IDENTITY_ERROR_MESSAGES } from '../../modules/08-identity-core/public';

let registered = false;

/** Registers every module's error messages once (safe to call repeatedly). */
export function registerAllErrorMessages(): void {
  if (registered) return;
  registered = true;
  registerErrorMessages(VALIDATION_ERROR_MESSAGES);
  registerErrorMessages(FILE_ERROR_MESSAGES);
  registerErrorMessages(IDENTITY_ERROR_MESSAGES);
}
