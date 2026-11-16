import type { ErrorMessageEntry } from '../../../03-error-localization/public';
import { MemorizationErrorCodes as C } from '../../domain/errors/memorization-errors';

export const MEMORIZATION_ERROR_MESSAGES: readonly ErrorMessageEntry[] = [
  { code: C.MEMORIZATION_RANGE_REQUIRED, message: { ar: 'يجب تحديد نطاق الحفظ (البداية والوحدة والكمية والاتجاه).', en: 'The memorization range (start, unit, amount, direction) is required.' } },
  { code: C.MEMORIZATION_RECORDS_REQUIRED, message: { ar: 'يجب إرسال سجل حفظ واحد على الأقل.', en: 'At least one memorization record is required.' } },
  { code: C.MEMORIZATION_TOO_MANY_RECORDS, message: { ar: 'عدد سجلات الحفظ في الطلب الواحد يتجاوز الحد ({max}).', en: 'Too many memorization records in one request (maximum {max}).' } },
  { code: C.MEMORIZATION_INVALID_RECORD, message: { ar: 'سجل الحفظ غير صالح.', en: 'The memorization record is not valid.' } },
  { code: C.MEMORIZATION_REASON_TOO_LONG, message: { ar: 'سبب التصحيح أطول من الحد المسموح ({max} حرف).', en: 'The correction reason is longer than the allowed {max} characters.' } },
  { code: C.MEMORIZATION_STUDENT_REQUIRED, message: { ar: 'مجموعة الحفظ الفردي تتطلب تحديد الطالب لكل تكليف.', en: 'An individual group requires a student for every assignment.' } },
  { code: C.MEMORIZATION_GROUP_ASSIGNMENT_NO_STUDENT, message: { ar: 'المجموعة الجماعية لها تكليف واحد مشترك ولا يمكن تحديد تكليف لطالب بعينه.', en: 'A collective group has one shared assignment; an assignment for an individual student is not allowed.' } },
  { code: C.MEMORIZATION_NOT_SESSION_TEACHER, message: { ar: 'هذا الإجراء مخصص لمعلم هذه الجلسة فقط.', en: 'Only the Teacher assigned to this session may do this.' } },
  { code: C.MEMORIZATION_READ_NOT_ALLOWED, message: { ar: 'لا يمكنك الاطلاع على حفظ هذه الجلسة.', en: 'You cannot read the memorization of this session.' } },
  { code: C.MEMORIZATION_SESSION_CANCELLED, message: { ar: 'لا يمكن تسجيل الحفظ لجلسة ملغاة.', en: 'Memorization cannot be recorded for a cancelled session.' } },
  { code: C.MEMORIZATION_ASSIGNMENT_WINDOW_CLOSED, message: { ar: 'لا يمكن تحديد تكليف الجلسة القادمة أو تعديله أو إلغاؤه إلا أثناء سير الجلسة الحالية؛ وبعد انتهائها يصبح التكليف نهائيًا.', en: 'The next-session assignment can be defined, modified or cancelled only while the current session is in progress; after it ends the assignment is final.' } },
  { code: C.MEMORIZATION_ASSIGNMENT_NOT_FOUND, message: { ar: 'تكليف الحفظ غير موجود.', en: 'The memorization assignment does not exist.' } },
  { code: C.MEMORIZATION_RECORD_NOT_FOUND, message: { ar: 'سجل الحفظ غير موجود.', en: 'The memorization record does not exist.' } },
  { code: C.MEMORIZATION_ASSIGNMENT_CANCELLED, message: { ar: 'تكليف الحفظ ملغى ولا يمكن تعديله.', en: 'The memorization assignment is cancelled and cannot be changed.' } },
  { code: C.MEMORIZATION_ASSIGNMENT_ALREADY_DEFINED, message: { ar: 'يوجد تكليف قائم لهذه الجلسة لنفس الطالب أو المجموعة؛ عدّله أو ألغِه أولًا.', en: 'An assignment already exists from this session for the same student or group; modify or cancel it first.' } },
  { code: C.MEMORIZATION_REPEAT_REQUIRED, message: { ar: 'لم يُكمل الطالب المقرر كاملًا، فيجب إعادة التكليف الأصلي كاملًا في الجلسة القادمة وليس الجزء غير المكتمل فقط.', en: 'The student did not memorize the whole assigned range, so the entire original assignment must be repeated in the next session (not only the unfinished part).' } },
  { code: C.MEMORIZATION_RECORD_CONFLICTS_WITH_NEXT_ASSIGNMENT, message: { ar: 'هذا التسجيل لا يُكمل التكليف، ويوجد تكليف قادم مختلف للطالب؛ عدّل التكليف القادم ليطابق التكليف الأصلي أو ألغِه أولًا.', en: 'This record does not fulfil the assignment while a different next assignment exists for the student; change it to the original assignment or cancel it first.' } },
  { code: C.MEMORIZATION_STUDENT_NOT_IN_GROUP, message: { ar: 'بعض الطلاب غير مسجلين حاليًا في مجموعة هذه الجلسة.', en: 'Some students are not currently assigned to the group of this session.' } },
  { code: C.MEMORIZATION_CORRECTION_WINDOW_CLOSED, message: { ar: 'لا يمكن تصحيح سجل الحفظ إلا أثناء الجلسة نفسها؛ وبعد انتهائها يصبح السجل نهائيًا.', en: 'A memorization record can be corrected only during its own session; after it ends the record is final.' } },
  { code: C.MEMORIZATION_CONCURRENT_CHANGE, message: { ar: 'تم تعديل البيانات نفسها في الوقت ذاته. أعد المحاولة.', en: 'The same data was changed at the same time. Please try again.' } },
];
