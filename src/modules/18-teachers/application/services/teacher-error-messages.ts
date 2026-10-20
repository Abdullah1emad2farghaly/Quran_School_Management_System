import type { ErrorMessageEntry } from '../../../03-error-localization/public';
import { TeacherErrorCodes } from '../../domain/errors/teacher-errors';

export const TEACHER_ERROR_MESSAGES: readonly ErrorMessageEntry[] = [
  { code: TeacherErrorCodes.INVALID_TEACHER_NAME, message: { ar: 'اسم المعلم غير صالح: يجب أن يتكوّن من ثلاثة أجزاء بالضبط ولا يتجاوز 200 حرف.', en: 'The teacher name is not valid: it must have exactly three parts and at most 200 characters.' } },
  { code: TeacherErrorCodes.TEACHER_NOT_FOUND, message: { ar: 'المعلم غير موجود.', en: 'The teacher was not found.' } },
  { code: TeacherErrorCodes.TEACHER_IDENTITY_CONFLICT, message: { ar: 'رقم الهاتف مسجّل لحساب آخر ولا يمكن مطابقة الاسم؛ لم يتم دمج الحسابات.', en: 'This phone number belongs to an existing account whose stored name is missing or different; accounts are never merged automatically.' } },
  { code: TeacherErrorCodes.TEACHER_ORGANIZATION_CONFLICT, message: { ar: 'هذا الحساب مسجّل في مؤسسة أخرى ولا يمكن استخدامه عبر المؤسسات.', en: 'This account belongs to another organization and cannot be reused across organizations.' } },
  { code: TeacherErrorCodes.TEACHER_ALREADY_LINKED_TO_SCHOOL, message: { ar: 'المعلم مرتبط بهذه المدرسة بالفعل.', en: 'The teacher is already linked to this school.' } },
  { code: TeacherErrorCodes.TEACHER_SCHOOL_LINK_NOT_FOUND, message: { ar: 'المعلم غير مرتبط بهذه المدرسة.', en: 'The teacher is not linked to this school.' } },
  { code: TeacherErrorCodes.TEACHER_SCHOOL_NOT_ACTIVE, message: { ar: 'المدرسة غير موجودة أو غير نشطة.', en: 'The school does not exist or is not active.' } },
  { code: TeacherErrorCodes.TEACHER_ACCOUNT_INACTIVE, message: { ar: 'الحساب المسجّل بهذا الرقم معطّل.', en: 'The account registered with this phone number is inactive.' } },
  { code: TeacherErrorCodes.TEACHER_CONCURRENT_MODIFICATION, message: { ar: 'تم تعديل المعلم بواسطة عملية أخرى؛ أعد المحاولة.', en: 'The teacher was changed by another operation; try again.' } },
  { code: TeacherErrorCodes.TEACHER_HAS_GROUPS_IN_SCHOOL, message: { ar: 'لا يمكن إزالة ارتباط المعلم بالمدرسة لأن لديه حلقات فيها.', en: 'The teacher cannot be unlinked from this school because they still have groups in it.' } },
];
