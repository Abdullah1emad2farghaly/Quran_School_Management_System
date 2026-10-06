import { ErrorCodes } from '../../../00-shared-kernel/public';
import type { ErrorMessageEntry } from './message-catalog';

/** Messages for the foundation error codes defined in the Shared Kernel. */
export const FOUNDATION_ERROR_MESSAGES: readonly ErrorMessageEntry[] = [
  { code: ErrorCodes.INTERNAL_ERROR, message: { ar: 'حدث خطأ غير متوقع.', en: 'An unexpected error occurred.' } },
  { code: ErrorCodes.NOT_FOUND, message: { ar: 'المورد المطلوب غير موجود.', en: 'The requested resource was not found.' } },
  { code: ErrorCodes.VALIDATION_FAILED, message: { ar: 'فشل التحقق من صحة البيانات.', en: 'Validation failed.' } },
  { code: ErrorCodes.INVALID_JSON, message: { ar: 'جسم الطلب ليس JSON صالحًا.', en: 'The request body is not valid JSON.' } },
  { code: ErrorCodes.PAYLOAD_TOO_LARGE, message: { ar: 'حجم الطلب أكبر من المسموح.', en: 'The request payload is too large.' } },
  { code: ErrorCodes.CORS_NOT_ALLOWED, message: { ar: 'المصدر غير مسموح به.', en: 'Origin not allowed.' } },
  { code: ErrorCodes.INVALID_IDENTIFIER, message: { ar: 'المعرّف غير صالح.', en: 'The identifier is not valid.' } },
  { code: ErrorCodes.INVALID_DATE, message: { ar: 'التاريخ غير صالح.', en: 'The date is not valid.' } },
];
