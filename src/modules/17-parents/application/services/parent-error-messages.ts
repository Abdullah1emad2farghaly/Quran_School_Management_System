import type { ErrorMessageEntry } from '../../../03-error-localization/public';
import { ParentErrorCodes } from '../../domain/errors/parent-errors';

export const PARENT_ERROR_MESSAGES: readonly ErrorMessageEntry[] = [
  { code: ParentErrorCodes.INVALID_PARENT_NAME, message: { ar: 'اسم ولي الأمر غير صالح: يجب أن يتكوّن من ثلاثة أجزاء بالضبط ولا يتجاوز 200 حرف.', en: 'The parent name is not valid: it must have exactly three parts and at most 200 characters.' } },
  { code: ParentErrorCodes.PARENT_ADDRESS_REQUIRED, message: { ar: 'العنوان مطلوب: أرسل نص العنوان (المحافظة / المركز أو المدينة / القرية) أو حقول العنوان، وليس كليهما.', en: 'The address is required: send the address text (Governorate / Center or City / Village) or the address fields, not both.' } },
  { code: ParentErrorCodes.PARENT_UPDATE_EMPTY, message: { ar: 'لا يوجد أي تعديل مطلوب: أرسل العنوان.', en: 'Nothing to update: send the address.' } },
  { code: ParentErrorCodes.PARENT_NOT_FOUND, message: { ar: 'ولي الأمر غير موجود.', en: 'The parent was not found.' } },
  { code: ParentErrorCodes.PARENT_IDENTITY_CONFLICT, message: { ar: 'رقم الهاتف مسجّل لحساب آخر ولا يمكن التأكد من أنه نفس الشخص؛ لم يتم دمج الحسابات.', en: 'This phone number belongs to an existing account and it cannot be confirmed to be the same person; accounts are never merged automatically.' } },
  { code: ParentErrorCodes.PARENT_ORGANIZATION_CONFLICT, message: { ar: 'ولي الأمر هذا مسجّل في مؤسسة أخرى ولا يمكن استخدامه عبر المؤسسات.', en: 'This parent belongs to another organization and cannot be reused across organizations.' } },
  { code: ParentErrorCodes.PARENT_ALREADY_LINKED_TO_SCHOOL, message: { ar: 'ولي الأمر مرتبط بهذه المدرسة بالفعل.', en: 'The parent is already linked to this school.' } },
  { code: ParentErrorCodes.PARENT_SCHOOL_LINK_NOT_FOUND, message: { ar: 'ولي الأمر غير مرتبط بهذه المدرسة.', en: 'The parent is not linked to this school.' } },
  { code: ParentErrorCodes.PARENT_SCHOOL_NOT_ACTIVE, message: { ar: 'المدرسة غير موجودة أو غير نشطة.', en: 'The school does not exist or is not active.' } },
  { code: ParentErrorCodes.PARENT_ACCOUNT_INACTIVE, message: { ar: 'الحساب المسجّل بهذا الرقم معطّل.', en: 'The account registered with this phone number is inactive.' } },
  { code: ParentErrorCodes.PARENT_HAS_STUDENTS_IN_SCHOOL, message: { ar: 'لا يمكن إزالة ارتباط ولي الأمر بالمدرسة لأن لديه طلابًا فيها.', en: 'The parent cannot be unlinked from this school because they still have students in it.' } },
  { code: ParentErrorCodes.PARENT_CONCURRENT_MODIFICATION, message: { ar: 'تم تعديل ولي الأمر بواسطة عملية أخرى؛ أعد المحاولة.', en: 'The parent was changed by another operation; try again.' } },
];
