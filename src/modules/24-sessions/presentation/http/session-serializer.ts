import type { ClassSessionDto } from '../../application/dto/session-dto';

const iso = (d: Date): string => d.toISOString();
const isoOrNull = (d: Date | null): string | null => (d ? d.toISOString() : null);

/** The public JSON of a session (instants are UTC ISO-8601; `occurrenceDate` is the business date in Africa/Cairo). */
export const serializeSession = (s: ClassSessionDto) => ({
  id: s.id,
  schoolId: s.schoolId,
  groupId: s.groupId,
  teacherId: s.teacherId,
  slotId: s.slotId,
  occurrenceDate: s.occurrenceDate,
  scheduledStart: iso(s.scheduledStart),
  scheduledEnd: iso(s.scheduledEnd),
  status: s.status,
  createdAt: iso(s.createdAt),
  startedAt: isoOrNull(s.startedAt),
  completedAt: isoOrNull(s.completedAt),
  cancelledAt: isoOrNull(s.cancelledAt),
  cancelledBy: s.cancelledBy,
  cancelSource: s.cancelSource,
  cancelReason: s.cancelReason,
  slotRetireReason: s.slotRetireReason,
});
