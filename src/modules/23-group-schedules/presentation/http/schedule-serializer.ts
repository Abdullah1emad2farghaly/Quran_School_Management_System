import type { OwnScheduleItemDto, ScheduleSlotDto } from '../../application/dto/schedule-dto';

const iso = (d: Date): string => d.toISOString();
const isoOrNull = (d: Date | null): string | null => (d ? d.toISOString() : null);

/** The public JSON of a schedule slot (times are local wall-clock `HH:MM`; no zone). */
export const serializeSlot = (s: ScheduleSlotDto) => ({
  id: s.id,
  groupId: s.groupId,
  dayOfWeek: s.dayOfWeek,
  startTime: s.startTime,
  endTime: s.endTime,
  status: s.status,
  createdAt: iso(s.createdAt),
  createdBy: s.createdBy,
  retiredAt: isoOrNull(s.retiredAt),
  retiredBy: s.retiredBy,
  retireReason: s.retireReason,
  replacedBySlotId: s.replacedBySlotId,
});

export const serializeOwnItem = (i: OwnScheduleItemDto) => ({ id: i.id, groupId: i.groupId, groupName: i.groupName, schoolId: i.schoolId, dayOfWeek: i.dayOfWeek, startTime: i.startTime, endTime: i.endTime });
