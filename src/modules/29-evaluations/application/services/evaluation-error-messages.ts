import type { ErrorMessageEntry } from '../../../03-error-localization/public';
import { EvaluationErrorCodes as C } from '../../domain/errors/evaluation-errors';

export const EVALUATION_ERROR_MESSAGES: readonly ErrorMessageEntry[] = [
  { code: C.EVALUATION_RECORDS_REQUIRED, message: { ar: 'يجب إرسال تقييم طالب واحد على الأقل.', en: 'At least one student evaluation is required.' } },
  { code: C.EVALUATION_TOO_MANY_RECORDS, message: { ar: 'عدد الطلاب في الطلب الواحد يتجاوز الحد ({max}).', en: 'Too many students in one request (maximum {max}).' } },
  { code: C.EVALUATION_INVALID_RECORD, message: { ar: 'بيانات تقييم الطالب غير صالحة.', en: 'The student evaluation is not valid.' } },
  { code: C.EVALUATION_DUPLICATE_STUDENT, message: { ar: 'الطالب مذكور أكثر من مرة في الطلب نفسه.', en: 'A student appears more than once in the same request.' } },
  { code: C.EVALUATION_INVALID_CATEGORY, message: { ar: 'فئة التقييم غير صالحة. القيم المسموحة: MEMORIZATION أو REVISION أو PERFORMANCE أو TAJWEED.', en: 'The evaluation category is not valid. Allowed values: MEMORIZATION, REVISION, PERFORMANCE or TAJWEED.' } },
  { code: C.EVALUATION_DUPLICATE_CATEGORY, message: { ar: 'فئة التقييم مذكورة أكثر من مرة للطالب نفسه.', en: 'An evaluation category appears more than once for the same student.' } },
  { code: C.EVALUATION_INVALID_SCORE, message: { ar: 'الدرجة غير صالحة. يجب أن تكون رقمًا من 0 إلى 10.', en: 'The score is not valid. It must be a number from 0 to 10.' } },
  { code: C.EVALUATION_INVALID_NOTE, message: { ar: 'الملاحظة غير صالحة. يجب أن تكون نصًا.', en: 'The note is not valid. It must be text.' } },
  { code: C.EVALUATION_NOTE_TOO_LONG, message: { ar: 'الملاحظة أطول من الحد المسموح ({max} حرف).', en: 'The note is longer than the allowed {max} characters.' } },
  { code: C.EVALUATION_NOTE_IMMUTABLE, message: { ar: 'الملاحظة تُحفظ مرة واحدة مع التقييم ولا يمكن تعديلها أو إضافتها لاحقًا أو حذفها.', en: 'The note is saved once, with the evaluation, and cannot be edited, added later or deleted.' } },
  { code: C.EVALUATION_CATEGORIES_MISMATCH, message: { ar: 'فئات التقييم المرسلة لا تطابق الفئات المتاحة للطالب.', en: 'The submitted evaluation categories do not match the categories available to the student.' } },
  { code: C.EVALUATION_NO_APPLICABLE_ASSIGNMENT, message: { ar: 'لا يوجد للطالب تكليف حفظ أو مراجعة لهذه الجلسة، فلا يوجد ما يُقيَّم.', en: 'The student has no memorization or revision assignment for this session, so there is nothing to evaluate.' } },
  { code: C.EVALUATION_STUDENT_ABSENT, message: { ar: 'لا يمكن تقييم طالب مسجّل غائبًا في هذه الجلسة.', en: 'A student marked ABSENT in this session cannot be evaluated.' } },
  { code: C.EVALUATION_STUDENT_NOT_IN_GROUP, message: { ar: 'بعض الطلاب غير مسجلين حاليًا في مجموعة هذه الجلسة.', en: 'Some students are not currently assigned to the group of this session.' } },
  { code: C.EVALUATION_GRACE_CREATE_ONLY, message: { ar: 'بعد نهاية الجلسة يمكن فقط تسجيل التقييمات الناقصة خلال {minutes} دقيقة، ولا يمكن تعديل تقييم مسجّل.', en: 'After the session ends only missing evaluations can be recorded, within {minutes} minutes; a recorded evaluation cannot be changed.' } },
  { code: C.EVALUATION_WRITE_WINDOW_CLOSED, message: { ar: 'انتهت مهلة تسجيل التقييمات لهذه الجلسة نهائيًا.', en: 'The time allowed for recording evaluations for this session has closed permanently.' } },
  { code: C.EVALUATION_SESSION_CANCELLED, message: { ar: 'لا يمكن تسجيل التقييم لجلسة ملغاة.', en: 'Evaluations cannot be recorded for a cancelled session.' } },
  { code: C.EVALUATION_READ_NOT_ALLOWED, message: { ar: 'لا يمكنك الاطلاع على تقييمات هذه الجلسة.', en: 'You cannot read the evaluations of this session.' } },
  { code: C.EVALUATION_CONCURRENT_CHANGE, message: { ar: 'تم تغيير التقييم في الوقت نفسه من طلب آخر. أعد المحاولة.', en: 'The evaluation was changed at the same time by another request. Try again.' } },
];
