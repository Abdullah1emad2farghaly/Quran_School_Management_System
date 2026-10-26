import { registerErrorMessages } from '../../modules/03-error-localization/public';
import { VALIDATION_ERROR_MESSAGES } from '../../modules/04-validation-api/public';
import { FILE_ERROR_MESSAGES } from '../../modules/07-file-infrastructure/public';
import { IDENTITY_ERROR_MESSAGES } from '../../modules/08-identity-core/public';
import { ROLE_ERROR_MESSAGES } from '../../modules/09-roles-permissions/public';
import { SESSION_ERROR_MESSAGES } from '../../modules/10-sessions-jwt/public';
import { RECOVERY_ERROR_MESSAGES } from '../../modules/11-otp-password-recovery/public';
import { ORGANIZATION_ERROR_MESSAGES } from '../../modules/13-organization-core/public';
import { GEOGRAPHY_ERROR_MESSAGES } from '../../modules/14-geography/public';
import { SCHOOL_ERROR_MESSAGES } from '../../modules/16-schools/public';
import { PARENT_ERROR_MESSAGES } from '../../modules/17-parents/public';
import { TEACHER_ERROR_MESSAGES } from '../../modules/18-teachers/public';
import { STUDENT_ERROR_MESSAGES } from '../../modules/19-students/public';
import { GROUP_ERROR_MESSAGES } from '../../modules/20-groups/public';
import { QURAN_ERROR_MESSAGES } from '../../modules/21-quran-structure/public';
import { UNIFIED_ADDRESS_ERROR_MESSAGES } from '../../modules/15-unified-address/public';
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
  registerErrorMessages(ORGANIZATION_ERROR_MESSAGES);
  registerErrorMessages(GEOGRAPHY_ERROR_MESSAGES);
  registerErrorMessages(UNIFIED_ADDRESS_ERROR_MESSAGES);
  registerErrorMessages(SCHOOL_ERROR_MESSAGES);
  registerErrorMessages(PARENT_ERROR_MESSAGES);
  registerErrorMessages(TEACHER_ERROR_MESSAGES);
  registerErrorMessages(STUDENT_ERROR_MESSAGES);
  registerErrorMessages(GROUP_ERROR_MESSAGES);
  registerErrorMessages(QURAN_ERROR_MESSAGES);
}
