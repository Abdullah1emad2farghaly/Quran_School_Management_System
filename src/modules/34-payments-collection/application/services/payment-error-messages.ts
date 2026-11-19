import type { ErrorMessageEntry } from '../../../03-error-localization/public';
import { PaymentErrorCodes as C } from '../../domain/errors/payment-errors';

export const PAYMENT_ERROR_MESSAGES: readonly ErrorMessageEntry[] = [
  { code: C.PAYMENT_NOT_FOUND, message: { ar: 'الدفعة غير موجودة.', en: 'The payment was not found.' } },
  { code: C.PAYMENT_ALREADY_RECORDED, message: { ar: 'يوجد دفعة ناجحة لهذا الاشتراك بالفعل.', en: 'This subscription already has a successful payment.' } },
  { code: C.PAYMENT_ALREADY_REVERSED, message: { ar: 'تم إلغاء هذه الدفعة بالفعل.', en: 'This payment has already been reversed.' } },
  { code: C.PAYMENT_REVERSAL_REASON_REQUIRED, message: { ar: 'سبب إلغاء الدفعة مطلوب.', en: 'A reason is required to reverse a payment.' } },
  { code: C.PAYMENT_REVERSAL_REASON_TOO_LONG, message: { ar: 'سبب إلغاء الدفعة طويل جدًا (الحد الأقصى 500 حرف).', en: 'The reversal reason is too long (at most 500 characters).' } },
  { code: C.PAYMENT_METHOD_NOT_ALLOWED, message: { ar: 'طريقة الدفع المسموح بها هي النقدي فقط.', en: 'Cash is the only allowed payment method.' } },
  { code: C.INVALID_PAYMENT_MONTH, message: { ar: 'صيغة الشهر غير صحيحة؛ استخدم YYYY-MM.', en: 'The month is not valid; use YYYY-MM.' } },
  { code: C.PAYMENT_CONCURRENT_MODIFICATION, message: { ar: 'تم تعديل الدفعة بواسطة عملية أخرى؛ أعد المحاولة.', en: 'The payment was changed by another operation; try again.' } },
];
