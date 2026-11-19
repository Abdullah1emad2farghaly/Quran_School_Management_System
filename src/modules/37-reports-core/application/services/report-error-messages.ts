import type { ErrorMessageEntry } from '../../../03-error-localization/public';
import { ReportErrorCodes as C } from '../../domain/errors/report-errors';

export const REPORT_ERROR_MESSAGES: readonly ErrorMessageEntry[] = [
  { code: C.INVALID_REPORT_PERIOD, message: { ar: 'الفترة غير صحيحة؛ القيم المسموحة: THIS_MONTH أو LAST_MONTH أو ACROSS_TIME أو CUSTOM.', en: 'The period is not valid; use THIS_MONTH, LAST_MONTH, ACROSS_TIME or CUSTOM.' } },
  { code: C.REPORT_CUSTOM_DATES_REQUIRED, message: { ar: 'الفترة المخصصة تحتاج إلى تاريخ بداية وتاريخ نهاية.', en: 'A custom period needs a start date and an end date.' } },
  { code: C.REPORT_PERIOD_DATES_NOT_ALLOWED, message: { ar: 'التواريخ مسموحة للفترة المخصصة فقط.', en: 'Dates are only allowed for a custom period.' } },
  { code: C.INVALID_REPORT_DATE, message: { ar: 'التاريخ غير صحيح؛ استخدم الصيغة YYYY-MM-DD.', en: 'The date is not valid; use YYYY-MM-DD.' } },
  { code: C.REPORT_PERIOD_START_AFTER_END, message: { ar: 'تاريخ البداية يجب ألا يكون بعد تاريخ النهاية.', en: 'The start date must not be after the end date.' } },
  { code: C.REPORT_NOT_ALLOWED, message: { ar: 'غير مسموح لك بهذا التقرير.', en: 'You are not allowed to run this report.' } },
  { code: C.REPORT_SCOPE_FORBIDDEN, message: { ar: 'هذه البيانات خارج نطاق صلاحياتك.', en: 'This data is outside your authorized scope.' } },
];
