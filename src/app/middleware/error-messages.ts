import { ErrorCodes } from '../../modules/00-shared-kernel/public';
import type { Locale } from '../../config/env';

/** Localized messages for foundation error codes. Codes never depend on language. */
const messages: Record<string, Record<Locale, string>> = {
  [ErrorCodes.INTERNAL_ERROR]: { ar: 'حدث خطأ غير متوقع.', en: 'An unexpected error occurred.' },
  [ErrorCodes.NOT_FOUND]: { ar: 'المورد المطلوب غير موجود.', en: 'The requested resource was not found.' },
  [ErrorCodes.VALIDATION_FAILED]: { ar: 'فشل التحقق من صحة البيانات.', en: 'Validation failed.' },
  [ErrorCodes.INVALID_JSON]: { ar: 'جسم الطلب ليس JSON صالحًا.', en: 'The request body is not valid JSON.' },
  [ErrorCodes.PAYLOAD_TOO_LARGE]: { ar: 'حجم الطلب أكبر من المسموح.', en: 'The request payload is too large.' },
  [ErrorCodes.CORS_NOT_ALLOWED]: { ar: 'المصدر غير مسموح به.', en: 'Origin not allowed.' },
  [ErrorCodes.INVALID_IDENTIFIER]: { ar: 'المعرّف غير صالح.', en: 'The identifier is not valid.' },
  [ErrorCodes.INVALID_DATE]: { ar: 'التاريخ غير صالح.', en: 'The date is not valid.' },
};

export function messageFor(code: string, locale: Locale): string {
  const entry = messages[code] ?? messages[ErrorCodes.INTERNAL_ERROR]!;
  return entry[locale] ?? entry.en;
}
