import type { ErrorMessageEntry } from '../../../03-error-localization/public';
import { UnifiedAddressErrorCodes } from '../../domain/errors/unified-address-errors';

export const UNIFIED_ADDRESS_ERROR_MESSAGES: readonly ErrorMessageEntry[] = [
  {
    code: UnifiedAddressErrorCodes.INVALID_PARENT_ADDRESS,
    message: {
      ar: 'العنوان غير صالح: المحافظة مطلوبة، ولا يمكن إدخال القرية دون المركز/المدينة، ولا يتجاوز كل جزء 200 حرف، ويُفصل بين الأجزاء بعلامة / دون أجزاء فارغة (محافظة / مركز أو مدينة / قرية).',
      en: 'The address is not valid: the governorate is required, a village needs a center/city, each part is at most 200 characters, and the parts are separated by / with no empty part (Governorate / Center or City / Village).',
    },
  },
  {
    code: UnifiedAddressErrorCodes.PARENT_ADDRESS_GOVERNORATE_NOT_FOUND,
    message: { ar: 'المحافظة غير مسجلة في النظام.', en: 'The governorate is not registered in the system.' },
  },
  {
    code: UnifiedAddressErrorCodes.PARENT_ADDRESS_GOVERNORATE_INACTIVE,
    message: { ar: 'المحافظة غير نشطة ولا يمكن استخدامها في عنوان جديد.', en: 'The governorate is inactive and cannot be used in a new or changed address.' },
  },
  {
    code: UnifiedAddressErrorCodes.ORGANIZATION_ADDRESS_COUNTRY_MISMATCH,
    message: { ar: 'المحافظة لا تتبع دولة المؤسسة المختارة.', en: 'The governorate does not belong to the selected organization country.' },
  },
  {
    code: UnifiedAddressErrorCodes.PARENT_ADDRESS_COUNTRY_MISMATCH,
    message: { ar: 'المحافظة لا تتبع دولة المؤسسة.', en: 'The governorate does not belong to the organization country.' },
  },
];
