import type { ErrorMessageEntry } from '../../../03-error-localization/public';
import { IdentityErrorCodes } from '../../domain/errors/identity-errors';

export const IDENTITY_ERROR_MESSAGES: readonly ErrorMessageEntry[] = [
  { code: IdentityErrorCodes.INVALID_PHONE_NUMBER, message: { ar: 'رقم الهاتف غير صالح.', en: 'The phone number is not valid.' } },
  {
    code: IdentityErrorCodes.INVALID_PASSWORD,
    message: {
      ar: 'يجب أن تتكوّن كلمة المرور من {min} إلى {max} حرفًا.',
      en: 'The password must be between {min} and {max} characters long.',
    },
  },
  {
    code: IdentityErrorCodes.USER_PHONE_ALREADY_EXISTS,
    message: { ar: 'رقم الهاتف مسجّل بالفعل لمستخدم آخر.', en: 'This phone number is already registered to a user.' },
  },
  { code: IdentityErrorCodes.USER_NOT_FOUND, message: { ar: 'المستخدم غير موجود.', en: 'The user was not found.' } },
  { code: IdentityErrorCodes.USER_ALREADY_ACTIVE, message: { ar: 'المستخدم مفعّل بالفعل.', en: 'The user is already active.' } },
  { code: IdentityErrorCodes.USER_ALREADY_INACTIVE, message: { ar: 'المستخدم معطّل بالفعل.', en: 'The user is already inactive.' } },
  {
    code: IdentityErrorCodes.USER_CONCURRENT_MODIFICATION,
    message: {
      ar: 'تم تعديل بيانات المستخدم من طلب آخر. أعد المحاولة.',
      en: 'The user was modified by another request. Please try again.',
    },
  },
];
