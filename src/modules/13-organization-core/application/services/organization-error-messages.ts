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
];
