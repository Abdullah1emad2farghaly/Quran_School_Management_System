import type { GroupScheduleSlot } from '../../domain/entities/group-schedule-slot';
import type { SlotRetireReason } from '../../domain/entities/group-schedule-slot';
import { formatMinutes, type DayOfWeek } from '../../domain/value-objects/schedule-time';

export interface ScheduleSlotDto {
  readonly id: string;
  readonly groupId: string;
  readonly dayOfWeek: DayOfWeek;
  /** Local wall-clock time, `HH:MM`. */
  readonly startTime: string;
  readonly endTime: string;
  readonly status: 'ACTIVE' | 'RETIRED';
  readonly createdAt: Date;
  readonly createdBy: string;
  readonly retiredAt: Date | null;
  readonly retiredBy: string | null;
  readonly retireReason: SlotRetireReason | null;
  readonly replacedBySlotId: string | null;
}

/** One slot of a Teacher's own weekly schedule, with the group it belongs to. */
export interface OwnScheduleItemDto {
  readonly id: string;
  readonly groupId: string;
  readonly groupName: string;
  readonly schoolId: string;
  readonly dayOfWeek: DayOfWeek;
  readonly startTime: string;
  readonly endTime: string;
}

export function toSlotDto(slot: GroupScheduleSlot): ScheduleSlotDto {
  const s = slot.snapshot;
  return {
    id: s.id,
    groupId: s.groupId,
    dayOfWeek: s.dayOfWeek,
    startTime: formatMinutes(s.startMinute),
    endTime: formatMinutes(s.endMinute),
    status: slot.isActive ? 'ACTIVE' : 'RETIRED',
    createdAt: s.createdAt,
    createdBy: s.createdBy,
    retiredAt: s.retiredAt,
    retiredBy: s.retiredBy,
    retireReason: s.retireReason,
    replacedBySlotId: s.replacedBySlotId,
  };
}
