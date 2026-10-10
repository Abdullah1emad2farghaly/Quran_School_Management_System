import type { ErrorMessageEntry } from '../../../03-error-localization/public';
import { RecoveryErrorCodes } from '../../domain/errors/recovery-errors';

export const RECOVERY_ERROR_MESSAGES: readonly ErrorMessageEntry[] = [
  {
    code: RecoveryErrorCodes.OTP_INVALID,
    message: { ar: 'رمز التحقق غير صحيح أو منتهي الصلاحية.', en: 'The verification code is incorrect or has expired.' },
  },
  {
    code: RecoveryErrorCodes.RESET_TOKEN_INVALID,
    message: {
      ar: 'رابط إعادة التعيين غير صالح أو منتهي. ابدأ من جديد.',
      en: 'The reset request is invalid or has expired. Please start again.',
    },
  },
  {
    code: RecoveryErrorCodes.RATE_LIMITED,
    message: { ar: 'عدد كبير من المحاولات. حاول مرة أخرى لاحقًا.', en: 'Too many requests. Please try again later.' },
  },
  {
    code: RecoveryErrorCodes.RECOVERY_CONCURRENT_MODIFICATION,
    message: { ar: 'تعذّر إكمال الطلب. أعد المحاولة.', en: 'The request could not be completed. Please try again.' },
  },
];
