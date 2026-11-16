import type { ErrorMessageEntry } from '../../../03-error-localization/public';
import { SessionErrorCodes } from '../../domain/errors/session-errors';

export const SESSION_ERROR_MESSAGES: readonly ErrorMessageEntry[] = [
  {
    code: SessionErrorCodes.AUTHENTICATION_REQUIRED,
    message: { ar: 'يجب تسجيل الدخول للمتابعة.', en: 'Authentication is required.' },
  },
  {
    code: SessionErrorCodes.INVALID_CREDENTIALS,
    message: { ar: 'رقم الهاتف أو كلمة المرور غير صحيحة.', en: 'The phone number or password is incorrect.' },
  },
  {
    code: SessionErrorCodes.ACCOUNT_INACTIVE,
    message: { ar: 'هذا الحساب معطّل.', en: 'This account is inactive.' },
  },
  {
    code: SessionErrorCodes.ACCESS_TOKEN_INVALID,
    message: { ar: 'رمز الدخول غير صالح.', en: 'The access token is not valid.' },
  },
  {
    code: SessionErrorCodes.ACCESS_TOKEN_EXPIRED,
    message: { ar: 'انتهت صلاحية رمز الدخول.', en: 'The access token has expired.' },
  },
  {
    code: SessionErrorCodes.SESSION_REVOKED,
    message: { ar: 'انتهت الجلسة. يرجى تسجيل الدخول من جديد.', en: 'The session has ended. Please sign in again.' },
  },
  {
    code: SessionErrorCodes.REFRESH_TOKEN_INVALID,
    message: { ar: 'رمز التجديد غير صالح.', en: 'The refresh token is not valid.' },
  },
  {
    code: SessionErrorCodes.REFRESH_TOKEN_EXPIRED,
    message: { ar: 'انتهت صلاحية رمز التجديد. يرجى تسجيل الدخول من جديد.', en: 'The refresh token has expired. Please sign in again.' },
  },
  {
    code: SessionErrorCodes.REFRESH_TOKEN_REUSED,
    message: {
      ar: 'تم استخدام رمز التجديد من قبل، وتم إنهاء الجلسة لأسباب أمنية. يرجى تسجيل الدخول من جديد.',
      en: 'This refresh token was already used. The session was ended for security reasons. Please sign in again.',
    },
  },
  {
    code: SessionErrorCodes.SESSION_CONCURRENT_MODIFICATION,
    message: { ar: 'تعذّر إكمال تسجيل الدخول. أعد المحاولة.', en: 'Sign-in could not be completed. Please try again.' },
  },
  {
    code: SessionErrorCodes.SESSION_LIMIT_REACHED,
    message: {
      ar: 'أنت مسجّل الدخول بالفعل على 3 أجهزة، وهو الحد الأقصى. سجّل الخروج من أحد أجهزتك الحالية ثم حاول مرة أخرى.',
      en: 'You are already signed in on 3 devices, which is the maximum. Sign out from one of your existing devices, then try again.',
    },
  },
  {
    code: SessionErrorCodes.SESSION_NOT_FOUND,
    message: { ar: 'لا توجد جلسة نشطة بهذا المعرّف في حسابك.', en: 'There is no active session with this id in your account.' },
  },
  {
    code: SessionErrorCodes.PASSWORD_CHANGE_REQUIRED,
    message: { ar: 'يجب تغيير كلمة المرور الأولية قبل متابعة استخدام النظام.', en: 'You must change your initial password before using the system.' },
  },
  {
    code: SessionErrorCodes.CURRENT_PASSWORD_INCORRECT,
    message: { ar: 'كلمة المرور الحالية غير صحيحة.', en: 'The current password is incorrect.' },
  },
  {
    code: SessionErrorCodes.NEW_PASSWORD_SAME_AS_CURRENT,
    message: { ar: 'كلمة المرور الجديدة يجب أن تختلف عن الحالية.', en: 'The new password must be different from the current one.' },
  },
  {
    code: SessionErrorCodes.ROLE_NOT_ASSIGNED,
    message: { ar: 'هذا الدور غير مسند إلى حسابك.', en: 'This role is not assigned to your account.' },
  },
];
