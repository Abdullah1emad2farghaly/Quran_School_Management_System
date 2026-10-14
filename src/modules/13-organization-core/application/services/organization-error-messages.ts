import type { ErrorMessageEntry } from '../../../03-error-localization/public';
import { OrganizationErrorCodes } from '../../domain/errors/organization-errors';

export const ORGANIZATION_ERROR_MESSAGES: readonly ErrorMessageEntry[] = [
  {
    code: OrganizationErrorCodes.INVALID_ORGANIZATION_NAME,
    message: {
      ar: 'اسم المؤسسة مطلوب (بالعربية أو الإنجليزية) ولا يتجاوز 200 حرف ولا يحتوي على رموز تحكم.',
      en: 'The organization name is required (Arabic or English), at most 200 characters, with no control characters.',
    },
  },
  {
    code: OrganizationErrorCodes.ORGANIZATION_ALREADY_EXISTS,
    message: { ar: 'توجد مؤسسة رئيسية بالفعل، ولا يُسمح بأكثر من مؤسسة واحدة.', en: 'The Main Organization already exists; only one organization is allowed.' },
  },
  {
    code: OrganizationErrorCodes.ORGANIZATION_NOT_FOUND,
    message: { ar: 'لم يتم إنشاء المؤسسة الرئيسية بعد.', en: 'The Main Organization has not been created yet.' },
  },
  {
    code: OrganizationErrorCodes.ORGANIZATION_COUNTRY_ALREADY_SET,
    message: {
      ar: 'تم تحديد دولة المؤسسة الرئيسية ولا يمكن تغييرها.',
      en: 'The Main Organization country is already set and cannot be changed.',
    },
  },
  {
    code: OrganizationErrorCodes.ORGANIZATION_COUNTRY_NOT_SET,
    message: {
      ar: 'لم يتم تحديد دولة المؤسسة الرئيسية بعد.',
      en: 'The Main Organization country has not been set yet.',
    },
  },
  {
    code: OrganizationErrorCodes.ORGANIZATION_NAME_ALREADY_EXISTS,
    message: { ar: 'يوجد مؤسسة بنفس الاسم بالفعل.', en: 'An organization with this name already exists.' },
  },
  {
    code: OrganizationErrorCodes.INVALID_ORGANIZATION_ADDRESS,
    message: {
      ar: 'عنوان المؤسسة غير صالح: المحافظة مطلوبة ولا يمكن اختيار القرية دون المركز/المدينة.',
      en: 'The organization address is not valid: the governorate is required and a village needs a center/city.',
    },
  },
  {
    code: OrganizationErrorCodes.ORGANIZATION_COUNTRY_INVALID,
    message: {
      ar: 'الدولة غير صالحة: يجب أن تكون معرّف دولة موجودة.',
      en: 'The country is not valid: it must be the identifier of an existing country.',
    },
  },
];
