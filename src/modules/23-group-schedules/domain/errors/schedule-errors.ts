import { AppError, type ErrorKind } from '../../../00-shared-kernel/public';

export const ScheduleErrorCodes = {
  /** The weekday is not one of SATURDAY ... FRIDAY. */
  SCHEDULE_DAY_INVALID: 'SCHEDULE_DAY_INVALID',
  /** A time is not exactly HH:MM on a 24-hour clock (00:00 to 23:59). */
  SCHEDULE_TIME_INVALID: 'SCHEDULE_TIME_INVALID',
  /** The end must be after the start on the same day (no empty slot, no crossing midnight). */
  SCHEDULE_TIME_RANGE_INVALID: 'SCHEDULE_TIME_RANGE_INVALID',
  /** A change names nothing to change. */
  SCHEDULE_UPDATE_EMPTY: 'SCHEDULE_UPDATE_EMPTY',
  /** The slot does not exist in this group, or it is already retired (one neutral code). */
  SCHEDULE_SLOT_NOT_FOUND: 'SCHEDULE_SLOT_NOT_FOUND',
  /** A group has at most ONE active slot per weekday, whatever the times (they may overlap, touch or be completely separate). */
  SCHEDULE_DAY_ALREADY_HAS_SLOT: 'SCHEDULE_DAY_ALREADY_HAS_SLOT',
  /** The group's Teacher would teach two overlapping slots (across all their ACTIVE groups in any school). Touching boundaries are not an overlap. */
  TEACHER_SCHEDULE_CONFLICT: 'TEACHER_SCHEDULE_CONFLICT',
  /** A concurrent change could not be resolved (a deadlock victim): retry. */
  SCHEDULE_CONCURRENT_MODIFICATION: 'SCHEDULE_CONCURRENT_MODIFICATION',
} as const;
export type ScheduleErrorCode = (typeof ScheduleErrorCodes)[keyof typeof ScheduleErrorCodes];

const KIND: Record<ScheduleErrorCode, ErrorKind> = {
  SCHEDULE_DAY_INVALID: 'VALIDATION',
  SCHEDULE_TIME_INVALID: 'VALIDATION',
  SCHEDULE_TIME_RANGE_INVALID: 'VALIDATION',
  SCHEDULE_UPDATE_EMPTY: 'VALIDATION',
  SCHEDULE_SLOT_NOT_FOUND: 'NOT_FOUND',
  SCHEDULE_DAY_ALREADY_HAS_SLOT: 'CONFLICT',
  TEACHER_SCHEDULE_CONFLICT: 'CONFLICT',
  SCHEDULE_CONCURRENT_MODIFICATION: 'CONFLICT',
};

export function scheduleError(code: ScheduleErrorCode, details?: unknown): AppError {
  return new AppError(code, KIND[code], details);
}
