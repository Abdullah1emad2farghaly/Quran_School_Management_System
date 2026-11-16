import type { ErrorMessageEntry } from '../../../03-error-localization/public';
import { RevisionErrorCodes as C } from '../../domain/errors/revision-errors';

export const REVISION_ERROR_MESSAGES: readonly ErrorMessageEntry[] = [
  { code: C.REVISION_RANGE_REQUIRED, message: { ar: 'يجب تحديد نطاق المراجعة (البداية والوحدة والكمية والاتجاه، أو من سورة إلى سورة).', en: 'The revision range (start, unit, amount, direction, or from Surah to Surah) is required.' } },
  { code: C.REVISION_RANGE_FORM_INVALID, message: { ar: 'يجب إرسال نطاق المراجعة بإحدى صيغتين فقط: (البداية والوحدة والكمية والاتجاه) أو (من سورة إلى سورة).', en: 'Send the revision range in exactly one form: (start, unit, amount, direction) or (from Surah to Surah).' } },
  { code: C.REVISION_UNIT_NOT_SUPPORTED, message: { ar: 'وحدة المراجعة يجب أن تكون: آيات أو صفحات أو أرباع أو سور.', en: 'The revision unit must be ayahs, pages, quarters or surahs.' } },
  { code: C.REVISION_SURAH_REQUIRED, message: { ar: 'عند اختيار وحدة الآيات يجب تحديد السورة.', en: 'With the ayahs unit the surah is required.' } },
  { code: C.REVISION_SURAH_NOT_ALLOWED, message: { ar: 'لا تُحدَّد سورة منفصلة مع الصفحات أو الأرباع أو السور.', en: 'No separate surah is selected with pages, quarters or surahs.' } },
  { code: C.REVISION_RECORDS_REQUIRED, message: { ar: 'يجب إرسال سجل مراجعة واحد على الأقل.', en: 'At least one revision record is required.' } },
  { code: C.REVISION_TOO_MANY_RECORDS, message: { ar: 'عدد سجلات المراجعة في الطلب الواحد يتجاوز الحد ({max}).', en: 'Too many revision records in one request (maximum {max}).' } },
  { code: C.REVISION_INVALID_RECORD, message: { ar: 'سجل المراجعة غير صالح.', en: 'The revision record is not valid.' } },
  { code: C.REVISION_REASON_TOO_LONG, message: { ar: 'سبب التصحيح أطول من الحد المسموح ({max} حرف).', en: 'The correction reason is longer than the allowed {max} characters.' } },
  { code: C.REVISION_STUDENT_REQUIRED, message: { ar: 'مجموعة المراجعة الفردي تتطلب تحديد الطالب لكل تكليف.', en: 'An individual group requires a student for every assignment.' } },
  { code: C.REVISION_GROUP_ASSIGNMENT_NO_STUDENT, message: { ar: 'المجموعة الجماعية لها تكليف واحد مشترك ولا يمكن تحديد تكليف لطالب بعينه.', en: 'A collective group has one shared assignment; an assignment for an individual student is not allowed.' } },
  { code: C.REVISION_NOT_SESSION_TEACHER, message: { ar: 'هذا الإجراء مخصص لمعلم هذه الجلسة فقط.', en: 'Only the Teacher assigned to this session may do this.' } },
  { code: C.REVISION_READ_NOT_ALLOWED, message: { ar: 'لا يمكنك الاطلاع على مراجعة هذه الجلسة.', en: 'You cannot read the revision of this session.' } },
  { code: C.REVISION_SESSION_CANCELLED, message: { ar: 'لا يمكن تسجيل المراجعة لجلسة ملغاة.', en: 'Revision cannot be recorded for a cancelled session.' } },
  { code: C.REVISION_ASSIGNMENT_WINDOW_CLOSED, message: { ar: 'لا يمكن تحديد تكليف الجلسة القادمة أو تعديله أو إلغاؤه إلا أثناء سير الجلسة الحالية؛ وبعد انتهائها يصبح التكليف نهائيًا.', en: 'The next-session assignment can be defined, modified or cancelled only while the current session is in progress; after it ends the assignment is final.' } },
  { code: C.REVISION_ASSIGNMENT_NOT_FOUND, message: { ar: 'تكليف المراجعة غير موجود.', en: 'The revision assignment does not exist.' } },
  { code: C.REVISION_RECORD_NOT_FOUND, message: { ar: 'سجل المراجعة غير موجود.', en: 'The revision record does not exist.' } },
  { code: C.REVISION_ASSIGNMENT_CANCELLED, message: { ar: 'تكليف المراجعة ملغى ولا يمكن تعديله.', en: 'The revision assignment is cancelled and cannot be changed.' } },
  { code: C.REVISION_ASSIGNMENT_ALREADY_DEFINED, message: { ar: 'يوجد تكليف قائم لهذه الجلسة لنفس الطالب أو المجموعة؛ عدّله أو ألغِه أولًا.', en: 'An assignment already exists from this session for the same student or group; modify or cancel it first.' } },
  { code: C.REVISION_REPEAT_REQUIRED, message: { ar: 'لم يُكمل الطالب نطاق المراجعة كاملًا، فيجب إعادة التكليف الأصلي كاملًا في الجلسة القادمة وليس الجزء غير المكتمل فقط.', en: 'The student did not revise the whole assigned range, so the entire original assignment must be repeated in the next session (not only the unfinished part).' } },
  { code: C.REVISION_RECORD_CONFLICTS_WITH_NEXT_ASSIGNMENT, message: { ar: 'هذا التسجيل لا يُكمل التكليف، ويوجد تكليف قادم مختلف للطالب؛ عدّل التكليف القادم ليطابق التكليف الأصلي أو ألغِه أولًا.', en: 'This record does not fulfil the assignment while a different next assignment exists for the student; change it to the original assignment or cancel it first.' } },
  { code: C.REVISION_STUDENT_NOT_IN_GROUP, message: { ar: 'بعض الطلاب غير مسجلين حاليًا في مجموعة هذه الجلسة.', en: 'Some students are not currently assigned to the group of this session.' } },
  { code: C.REVISION_CORRECTION_WINDOW_CLOSED, message: { ar: 'لا يمكن تصحيح سجل المراجعة إلا أثناء الجلسة نفسها؛ وبعد انتهائها يصبح السجل نهائيًا.', en: 'A revision record can be corrected only during its own session; after it ends the record is final.' } },
  { code: C.REVISION_CONCURRENT_CHANGE, message: { ar: 'تم تعديل البيانات نفسها في الوقت ذاته. أعد المحاولة.', en: 'The same data was changed at the same time. Please try again.' } },
];
