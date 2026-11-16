import type { ErrorMessageEntry } from '../../../03-error-localization/public';
import { QuranRangeErrorCodes } from '../../domain/errors/range-errors';

export const QURAN_RANGE_ERROR_MESSAGES: readonly ErrorMessageEntry[] = [
  {
    code: QuranRangeErrorCodes.QURAN_RANGE_UNIT_INVALID,
    message: { ar: 'وحدة النطاق غير صالحة؛ القيم المسموحة: السور، الآيات، الأرباع، الصفحات، الأسطر.', en: 'The range unit is not valid; allowed: SURAHS, AYAHS, QUARTERS, PAGES, LINES.' },
  },
  {
    code: QuranRangeErrorCodes.QURAN_RANGE_DIRECTION_INVALID,
    message: { ar: 'اتجاه النطاق غير صالح؛ القيم المسموحة: للأمام أو للخلف.', en: 'The range direction is not valid; allowed: FORWARD, BACKWARD.' },
  },
  {
    code: QuranRangeErrorCodes.QURAN_RANGE_AMOUNT_INVALID,
    message: { ar: 'يجب أن تكون الكمية عددًا صحيحًا موجبًا.', en: 'The amount must be a positive integer.' },
  },
  {
    code: QuranRangeErrorCodes.QURAN_RANGE_START_INVALID,
    message: { ar: 'موضع البداية غير صالح؛ يجب أن يكون سورة موجودة، ويمكن تحديد آية موجودة فيها.', en: 'The start position is not valid; it must be an existing surah, optionally with an ayah that exists in it.' },
  },
  {
    code: QuranRangeErrorCodes.QURAN_RANGE_EXCEEDS_QURAN,
    message: { ar: 'يتجاوز النطاق المطلوب حدود القرآن الكريم.', en: 'The requested range goes beyond the boundary of the Quran.' },
  },
  {
    code: QuranRangeErrorCodes.QURAN_RANGE_LAYOUT_INCONSISTENT,
    message: { ar: 'بيانات هيكل القرآن المستوردة غير متسقة؛ تعذّر حساب النطاق.', en: 'The imported Quran structure is inconsistent; the range could not be calculated.' },
  },
];
