import { registerErrorMessages } from '../../modules/03-error-localization/public';
import { VALIDATION_ERROR_MESSAGES } from '../../modules/04-validation-api/public';

let registered = false;

/** Registers every module's error messages once (safe to call repeatedly). */
export function registerAllErrorMessages(): void {
  if (registered) return;
  registered = true;
  registerErrorMessages(VALIDATION_ERROR_MESSAGES);
}
