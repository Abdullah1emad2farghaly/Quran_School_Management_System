import type { ErrorMessageEntry } from '../../../03-error-localization/public';
import { GeographyErrorCodes } from '../../domain/errors/geography-errors';

export const GEOGRAPHY_ERROR_MESSAGES: readonly ErrorMessageEntry[] = [
  {
    code: GeographyErrorCodes.INVALID_GEOGRAPHY_NAME,
    message: {
      ar: 'الاسم مطلوب (بالعربية أو الإنجليزية) ولا يتجاوز 200 حرف ولا يحتوي على رموز تحكم.',
      en: 'The name is required (Arabic or English), at most 200 characters, with no control characters.',
    },
  },
  {
    code: GeographyErrorCodes.GEOGRAPHY_NODE_NOT_FOUND,
    message: { ar: 'العنصر الجغرافي غير موجود.', en: 'The geographic record was not found.' },
  },
  {
    code: GeographyErrorCodes.GEOGRAPHY_NODE_ALREADY_EXISTS,
    message: { ar: 'يوجد عنصر جغرافي بنفس الاسم داخل نفس العنصر الأعلى.', en: 'A geographic record with the same name already exists under the same parent.' },
  },
  {
    code: GeographyErrorCodes.GEOGRAPHY_PARENT_NOT_FOUND,
    message: { ar: 'العنصر الجغرافي الأعلى غير موجود.', en: 'The parent geographic record was not found.' },
  },
  {
    code: GeographyErrorCodes.INVALID_GEOGRAPHY_HIERARCHY,
    message: {
      ar: 'التسلسل الجغرافي غير صحيح: المحافظة مطلوبة، والقرية تتطلب مركزًا/مدينة، ويجب أن يتبع كل عنصر العنصر الأعلى المحدد.',
      en: 'The geographic hierarchy is invalid: the governorate is required, a village needs a center/city, and each record must belong to the stated parent.',
    },
  },
  {
    code: GeographyErrorCodes.GEOGRAPHY_NODE_INACTIVE,
    message: { ar: 'العنصر الجغرافي غير نشط.', en: 'The geographic record is not active.' },
  },
];
