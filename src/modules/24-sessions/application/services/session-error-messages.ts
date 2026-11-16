import type { ErrorMessageEntry } from '../../../03-error-localization/public';
import { ClassSessionErrorCodes } from '../../domain/errors/session-errors';

export const CLASS_SESSION_ERROR_MESSAGES: readonly ErrorMessageEntry[] = [
  { code: ClassSessionErrorCodes.CLASS_SESSION_NOT_FOUND, message: { ar: 'الجلسة غير موجودة.', en: 'The session does not exist.' } },
  { code: ClassSessionErrorCodes.CLASS_SESSION_CANCEL_REASON_REQUIRED, message: { ar: 'سبب إلغاء الجلسة مطلوب ولا يمكن أن يكون فارغًا.', en: 'A reason for cancelling the session is required and cannot be empty.' } },
  { code: ClassSessionErrorCodes.CLASS_SESSION_CANCEL_REASON_TOO_LONG, message: { ar: 'سبب الإلغاء أطول من الحد المسموح (500 حرف).', en: 'The cancellation reason is longer than the allowed 500 characters.' } },
  { code: ClassSessionErrorCodes.CLASS_SESSION_NOT_CANCELLABLE, message: { ar: 'لا يمكن إلغاء جلسة مكتملة أو ملغاة بالفعل.', en: 'A completed or already cancelled session cannot be cancelled.' } },
  { code: ClassSessionErrorCodes.CLASS_SESSION_NOT_ASSIGNED_TEACHER, message: { ar: 'يمكن للمعلم المكلّف بالجلسة فقط إلغاؤها.', en: 'Only the Teacher assigned to the session can cancel it.' } },
];
