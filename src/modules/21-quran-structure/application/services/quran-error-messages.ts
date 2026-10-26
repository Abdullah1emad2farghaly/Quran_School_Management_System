import type { ErrorMessageEntry } from '../../../03-error-localization/public';
import { QuranErrorCodes } from '../../domain/errors/quran-errors';

export const QURAN_ERROR_MESSAGES: readonly ErrorMessageEntry[] = [
  {
    code: QuranErrorCodes.QURAN_DATASET_NOT_IMPORTED,
    message: { ar: 'لم يتم استيراد بيانات هيكل القرآن بعد.', en: 'The Quran structure data has not been imported yet.' },
  },
  { code: QuranErrorCodes.QURAN_SURAH_NOT_FOUND, message: { ar: 'السورة غير موجودة.', en: 'The surah was not found.' } },
  { code: QuranErrorCodes.QURAN_AYAH_NOT_FOUND, message: { ar: 'الآية غير موجودة.', en: 'The ayah was not found.' } },
  { code: QuranErrorCodes.QURAN_QUARTER_NOT_FOUND, message: { ar: 'الربع غير موجود.', en: 'The quarter was not found.' } },
  { code: QuranErrorCodes.QURAN_PAGE_NOT_FOUND, message: { ar: 'الصفحة غير موجودة.', en: 'The page was not found.' } },
  {
    code: QuranErrorCodes.QURAN_DATASET_REPLACEMENT_NOT_CONFIRMED,
    message: {
      ar: 'توجد بيانات قرآن مستوردة مختلفة؛ لا يتم استبدالها دون تأكيد صريح.',
      en: 'A different Quran dataset is already imported; it is not replaced without explicit confirmation.',
    },
  },
];
