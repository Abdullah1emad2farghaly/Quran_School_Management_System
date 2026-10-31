import type { ErrorMessageEntry } from '../../../03-error-localization/public';
import { AttendanceErrorCodes } from '../../domain/errors/attendance-errors';

export const ATTENDANCE_ERROR_MESSAGES: readonly ErrorMessageEntry[] = [
  { code: AttendanceErrorCodes.ATTENDANCE_RECORDS_REQUIRED, message: { ar: 'يجب إرسال سجل حضور واحد على الأقل.', en: 'At least one attendance record is required.' } },
  { code: AttendanceErrorCodes.ATTENDANCE_TOO_MANY_RECORDS, message: { ar: 'عدد سجلات الحضور في الطلب الواحد يتجاوز الحد ({max}).', en: 'Too many attendance records in one request (maximum {max}).' } },
  { code: AttendanceErrorCodes.ATTENDANCE_INVALID_RECORD, message: { ar: 'سجل الحضور غير صالح.', en: 'The attendance record is not valid.' } },
  { code: AttendanceErrorCodes.ATTENDANCE_INVALID_STATUS, message: { ar: 'حالة الحضور غير صالحة. القيم المسموحة: PRESENT أو ABSENT.', en: 'The attendance status is not valid. Allowed values: PRESENT or ABSENT.' } },
  { code: AttendanceErrorCodes.ATTENDANCE_DUPLICATE_STUDENT, message: { ar: 'الطالب مذكور أكثر من مرة في الطلب نفسه.', en: 'A student appears more than once in the same request.' } },
  { code: AttendanceErrorCodes.ATTENDANCE_CORRECTION_REASON_REQUIRED, message: { ar: 'سبب التصحيح مطلوب ولا يمكن أن يكون فارغًا.', en: 'A reason is required for a correction and cannot be empty.' } },
  { code: AttendanceErrorCodes.ATTENDANCE_REASON_TOO_LONG, message: { ar: 'سبب التصحيح أطول من الحد المسموح ({max} حرف).', en: 'The correction reason is longer than the allowed {max} characters.' } },
  { code: AttendanceErrorCodes.ATTENDANCE_SESSION_CANCELLED, message: { ar: 'لا يمكن تسجيل الحضور لجلسة ملغاة.', en: 'Attendance cannot be recorded for a cancelled session.' } },
  { code: AttendanceErrorCodes.ATTENDANCE_STUDENT_NOT_IN_GROUP, message: { ar: 'بعض الطلاب غير مسجلين حاليًا في مجموعة هذه الجلسة.', en: 'Some students are not currently assigned to the group of this session.' } },
  { code: AttendanceErrorCodes.ATTENDANCE_READ_NOT_ALLOWED, message: { ar: 'لا يمكنك الاطلاع على حضور هذه الجلسة.', en: 'You cannot read the attendance of this session.' } },
  { code: AttendanceErrorCodes.ATTENDANCE_CONCURRENT_CHANGE, message: { ar: 'تم تغيير سجل الحضور في الوقت نفسه من طلب آخر. أعد المحاولة.', en: 'The attendance record was changed at the same time by another request. Try again.' } },
];
