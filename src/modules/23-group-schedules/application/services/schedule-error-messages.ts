import type { ErrorMessageEntry } from '../../../03-error-localization/public';
import { ScheduleErrorCodes } from '../../domain/errors/schedule-errors';

export const SCHEDULE_ERROR_MESSAGES: readonly ErrorMessageEntry[] = [
  { code: ScheduleErrorCodes.SCHEDULE_DAY_INVALID, message: { ar: 'يوم الأسبوع غير صالح؛ القيم المسموحة: السبت، الأحد، الاثنين، الثلاثاء، الأربعاء، الخميس، الجمعة.', en: 'The weekday is not valid; allowed: SATURDAY, SUNDAY, MONDAY, TUESDAY, WEDNESDAY, THURSDAY, FRIDAY.' } },
  { code: ScheduleErrorCodes.SCHEDULE_TIME_INVALID, message: { ar: 'الوقت غير صالح؛ يجب أن يكون بصيغة HH:MM بنظام 24 ساعة (من 00:00 إلى 23:59).', en: 'The time is not valid; it must be HH:MM on a 24-hour clock (00:00 to 23:59).' } },
  { code: ScheduleErrorCodes.SCHEDULE_TIME_RANGE_INVALID, message: { ar: 'يجب أن يكون وقت النهاية بعد وقت البداية في اليوم نفسه.', en: 'The end time must be after the start time on the same day.' } },
  { code: ScheduleErrorCodes.SCHEDULE_UPDATE_EMPTY, message: { ar: 'لم يتم تحديد أي تغيير على الموعد.', en: 'No change to the slot was given.' } },
  { code: ScheduleErrorCodes.SCHEDULE_SLOT_NOT_FOUND, message: { ar: 'الموعد غير موجود في هذه الحلقة أو تم إنهاؤه.', en: 'The slot does not exist in this group or has been retired.' } },
  { code: ScheduleErrorCodes.SCHEDULE_DAY_ALREADY_HAS_SLOT, message: { ar: 'للحلقة موعد واحد فقط في اليوم الواحد؛ لدى الحلقة موعد في هذا اليوم بالفعل.', en: 'A group can have only one slot per weekday; this group already has a slot on that day.' } },
  { code: ScheduleErrorCodes.TEACHER_SCHEDULE_CONFLICT, message: { ar: 'يتعارض الموعد مع موعد آخر للمعلم في حلقاته النشطة.', en: "The slot overlaps another slot of the Teacher in their active groups." } },
  { code: ScheduleErrorCodes.SCHEDULE_CONCURRENT_MODIFICATION, message: { ar: 'تعذّر إتمام العملية بسبب تعديل متزامن؛ أعد المحاولة.', en: 'A concurrent change could not be resolved; retry.' } },
];
