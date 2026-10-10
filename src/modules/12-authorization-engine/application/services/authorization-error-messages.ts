import type { ErrorMessageEntry } from '../../../03-error-localization/public';
import { AuthorizationErrorCodes } from '../../domain/errors/authorization-errors';

export const AUTHORIZATION_ERROR_MESSAGES: readonly ErrorMessageEntry[] = [
  {
    code: AuthorizationErrorCodes.ACCESS_DENIED,
    message: { ar: 'ليست لديك صلاحية لتنفيذ هذا الإجراء.', en: 'You are not allowed to perform this action.' },
  },
  {
    code: AuthorizationErrorCodes.MAIN_ADMIN_ALREADY_EXISTS,
    message: {
      ar: 'يوجد مدير رئيسي نشط بالفعل، ولا يمكن إنشاء مدير رئيسي أولي آخر.',
      en: 'An active Main Admin already exists; an additional initial Main Admin cannot be created.',
    },
  },
  {
    code: AuthorizationErrorCodes.AUTHORIZATION_CONFIGURATION_ERROR,
    message: { ar: 'حدث خطأ داخلي في إعدادات الصلاحيات.', en: 'An internal authorization configuration error occurred.' },
  },
];
