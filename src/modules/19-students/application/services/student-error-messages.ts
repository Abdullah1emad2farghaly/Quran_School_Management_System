import type { ErrorMessageEntry } from '../../../03-error-localization/public';
import { StudentErrorCodes } from '../../domain/errors/student-errors';

export const STUDENT_ERROR_MESSAGES: readonly ErrorMessageEntry[] = [
  { code: StudentErrorCodes.INVALID_STUDENT_NAME, message: { ar: 'اسم الطالب غير صالح: يجب أن يتكوّن من ثلاثة أجزاء على الأقل ولا يتجاوز 200 حرف.', en: 'The student name is not valid: it must have at least three parts and at most 200 characters.' } },
  { code: StudentErrorCodes.STUDENT_NAME_PARENT_MISMATCH, message: { ar: 'اسم الطالب لا يطابق اسم ولي الأمر: الاسم الثاني هو الاسم الأول لولي الأمر والاسم الثالث هو الاسم الثاني لولي الأمر.', en: 'The student name does not match the parent name: the second name must be the parent\'s first name and the third name the parent\'s second name.' } },
  { code: StudentErrorCodes.INVALID_STUDENT_NATIONAL_ID, message: { ar: 'الرقم القومي غير صالح: يجب أن يتكوّن من 14 رقمًا بالضبط.', en: 'The national ID is not valid: it must be exactly 14 digits.' } },
  { code: StudentErrorCodes.INVALID_STUDENT_JOIN_DATE, message: { ar: 'تاريخ الالتحاق غير صالح: استخدم الصيغة YYYY-MM-DD.', en: 'The join date is not valid: use the format YYYY-MM-DD.' } },
  { code: StudentErrorCodes.INVALID_STUDENT_REASON, message: { ar: 'السبب غير صالح: نص لا يتجاوز 500 حرف.', en: 'The reason is not valid: text of at most 500 characters.' } },
  { code: StudentErrorCodes.STUDENT_UPDATE_EMPTY, message: { ar: 'لا يوجد أي تعديل مطلوب: أرسل الاسم أو تاريخ الالتحاق.', en: 'Nothing to update: send the name or the join date.' } },
  { code: StudentErrorCodes.STUDENT_NOT_FOUND, message: { ar: 'الطالب غير موجود.', en: 'The student was not found.' } },
  { code: StudentErrorCodes.STUDENT_SCHOOL_NOT_ACTIVE, message: { ar: 'المدرسة غير موجودة أو غير نشطة.', en: 'The school does not exist or is not active.' } },
  { code: StudentErrorCodes.STUDENT_PARENT_NOT_LINKED_TO_SCHOOL, message: { ar: 'ولي الأمر غير موجود أو غير مرتبط بهذه المدرسة.', en: 'The parent does not exist or is not linked to this school.' } },
  { code: StudentErrorCodes.STUDENT_NATIONAL_ID_CONFLICT, message: { ar: 'الرقم القومي مسجّل بالفعل لطالب آخر في النظام؛ لم يتم نقل الطالب أو استبداله.', en: 'This national ID is already registered for a student in the system; no student was moved or replaced.' } },
  { code: StudentErrorCodes.STUDENT_INVALID_STATUS_TRANSITION, message: { ar: 'لا يمكن تنفيذ هذا الإجراء على الطالب في حالته الحالية.', en: 'This action cannot be applied to the student in the current status.' } },
  { code: StudentErrorCodes.STUDENT_ARCHIVED, message: { ar: 'الطالب مؤرشف ولا يمكن تعديله.', en: 'The student is archived and cannot be changed.' } },
  { code: StudentErrorCodes.STUDENT_CONCURRENT_MODIFICATION, message: { ar: 'تم تعديل الطالب بواسطة عملية أخرى؛ أعد المحاولة.', en: 'The student was changed by another operation; try again.' } },
];
