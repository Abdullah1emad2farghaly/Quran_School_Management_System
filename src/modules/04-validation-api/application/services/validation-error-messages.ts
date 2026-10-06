import type { ErrorMessageEntry } from '../../../03-error-localization/public';

/** Field-level validation codes (Arabic + English). Registered at startup. */
export const VALIDATION_ERROR_MESSAGES: readonly ErrorMessageEntry[] = [
  { code: 'REQUIRED_FIELD', message: { ar: 'هذا الحقل مطلوب.', en: 'This field is required.' } },
  { code: 'INVALID_VALUE', message: { ar: 'القيمة غير صالحة.', en: 'The value is not valid.' } },
  { code: 'INVALID_PAGE', message: { ar: 'رقم الصفحة يجب أن يكون عددًا صحيحًا موجبًا.', en: 'Page must be a positive integer.' } },
  { code: 'INVALID_PAGE_SIZE', message: { ar: 'حجم الصفحة يجب أن يكون عددًا صحيحًا موجبًا.', en: 'Page size must be a positive integer.' } },
  { code: 'INVALID_SORT', message: { ar: 'صيغة الترتيب غير صالحة.', en: 'The sort format is not valid.' } },
  { code: 'UNKNOWN_SORT_FIELD', message: { ar: 'لا يمكن الترتيب حسب "{field}".', en: 'Sorting by "{field}" is not allowed.' } },
  { code: 'TOO_MANY_SORT_FIELDS', message: { ar: 'الحد الأقصى لحقول الترتيب هو {max}.', en: 'At most {max} sort fields are allowed.' } },
  { code: 'INVALID_FILTER', message: { ar: 'صيغة التصفية غير صالحة.', en: 'The filter format is not valid.' } },
  { code: 'UNKNOWN_FILTER', message: { ar: 'لا يمكن التصفية حسب "{field}".', en: 'Filtering by "{field}" is not allowed.' } },
  { code: 'INVALID_FILTER_VALUE', message: { ar: 'قيمة التصفية غير صالحة.', en: 'The filter value is not valid.' } },
  { code: 'INVALID_SEARCH', message: { ar: 'نص البحث غير صالح.', en: 'The search text is not valid.' } },
  { code: 'UNKNOWN_QUERY_PARAMETER', message: { ar: 'معامل الاستعلام "{field}" غير مدعوم.', en: 'Query parameter "{field}" is not supported.' } },
];
