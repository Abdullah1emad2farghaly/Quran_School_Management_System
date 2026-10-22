import type { ErrorMessageEntry } from '../../../03-error-localization/public';
import { GroupErrorCodes } from '../../domain/errors/group-errors';

export const GROUP_ERROR_MESSAGES: readonly ErrorMessageEntry[] = [
  { code: GroupErrorCodes.INVALID_GROUP_NAME, message: { ar: 'اسم المجموعة غير صالح: نص من 1 إلى 200 حرف.', en: 'The group name is not valid: text of 1 to 200 characters.' } },
  { code: GroupErrorCodes.INVALID_GROUP_LEARNING_MODE, message: { ar: 'نمط التعلّم غير صالح: GROUP أو INDIVIDUAL.', en: 'The learning mode is not valid: GROUP or INDIVIDUAL.' } },
  { code: GroupErrorCodes.INVALID_GROUP_PROGRESSION, message: { ar: 'اتجاه التقدّم غير صالح: FORWARD أو BACKWARD.', en: 'The progression direction is not valid: FORWARD or BACKWARD.' } },
  { code: GroupErrorCodes.INVALID_GROUP_STARTING_SURAH, message: { ar: 'السورة المبدوء بها غير صالحة: رقم صحيح من 1 إلى 114.', en: 'The starting surah is not valid: a whole number from 1 to 114.' } },
  { code: GroupErrorCodes.INVALID_GROUP_REASON, message: { ar: 'السبب غير صالح: نص لا يتجاوز 500 حرف.', en: 'The reason is not valid: text of at most 500 characters.' } },
  { code: GroupErrorCodes.GROUP_UPDATE_EMPTY, message: { ar: 'لا يوجد أي تعديل مطلوب.', en: 'Nothing to update.' } },
  { code: GroupErrorCodes.GROUP_NOT_FOUND, message: { ar: 'المجموعة غير موجودة.', en: 'The group was not found.' } },
  { code: GroupErrorCodes.GROUP_SCHOOL_NOT_ACTIVE, message: { ar: 'المدرسة غير موجودة أو غير نشطة.', en: 'The school does not exist or is not active.' } },
  { code: GroupErrorCodes.GROUP_NAME_CONFLICT, message: { ar: 'يوجد في هذه المدرسة مجموعة نشطة بنفس الاسم.', en: 'This school already has an active group with this name.' } },
  { code: GroupErrorCodes.GROUP_ARCHIVED, message: { ar: 'المجموعة مؤرشفة ولا يمكن تعديلها.', en: 'The group is archived and cannot be changed.' } },
  { code: GroupErrorCodes.GROUP_TEACHER_NOT_LINKED_TO_SCHOOL, message: { ar: 'المعلّم غير موجود أو غير مرتبط بهذه المدرسة.', en: 'The teacher does not exist or is not linked to this school.' } },
  { code: GroupErrorCodes.GROUP_HAS_NO_TEACHER, message: { ar: 'لا يوجد معلّم لهذه المجموعة.', en: 'This group has no teacher.' } },
  { code: GroupErrorCodes.GROUP_STUDENT_NOT_IN_SCHOOL, message: { ar: 'الطالب غير موجود أو ليس من طلاب مدرسة هذه المجموعة.', en: 'The student does not exist or is not a student of this group\'s school.' } },
  { code: GroupErrorCodes.GROUP_STUDENT_NOT_ACTIVE, message: { ar: 'لا يمكن إضافة إلا طالب نشط إلى مجموعة.', en: 'Only an active student can be added to a group.' } },
  { code: GroupErrorCodes.GROUP_STUDENT_ALREADY_ASSIGNED, message: { ar: 'الطالب موجود بالفعل في مجموعة؛ انقله أو أزله أولًا.', en: 'The student is already in a group; move or remove them first.' } },
  { code: GroupErrorCodes.GROUP_STUDENT_NOT_ASSIGNED, message: { ar: 'الطالب ليس في هذه المجموعة.', en: 'The student is not in this group.' } },
  { code: GroupErrorCodes.GROUP_MOVE_TARGET_INVALID, message: { ar: 'مجموعة الوجهة غير صالحة: يجب أن تكون مجموعة نشطة أخرى في نفس المدرسة.', en: 'The target group is not valid: it must be another active group of the same school.' } },
  { code: GroupErrorCodes.GROUP_CONCURRENT_MODIFICATION, message: { ar: 'تم تعديل المجموعة بواسطة عملية أخرى؛ أعد المحاولة.', en: 'The group was changed by another operation; try again.' } },
];
