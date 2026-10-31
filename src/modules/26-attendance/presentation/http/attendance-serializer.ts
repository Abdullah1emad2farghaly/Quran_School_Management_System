import type { AttendanceBatchResultDto, AttendanceRecordDto, SessionAttendanceDto } from '../../application/dto/attendance-dto';

const iso = (d: Date): string => d.toISOString();

/** The public JSON of an attendance record (instants are UTC ISO-8601; `occurrenceDate` is the Cairo business date of the session). */
export const serializeRecord = (r: AttendanceRecordDto) => ({
  id: r.id,
  sessionId: r.sessionId,
  schoolId: r.schoolId,
  groupId: r.groupId,
  subjectType: r.subjectType,
  subjectId: r.subjectId,
  status: r.status,
  occurrenceDate: r.occurrenceDate,
  scheduledStart: iso(r.scheduledStart),
  recordedBy: r.recordedBy,
  recordedByRole: r.recordedByRole,
  recordedAt: iso(r.recordedAt),
  updatedBy: r.updatedBy,
  updatedByRole: r.updatedByRole,
  updatedAt: iso(r.updatedAt),
});

export const serializeBatch = (b: AttendanceBatchResultDto) => ({
  sessionId: b.sessionId,
  results: b.results.map((r) => ({ subjectId: r.subjectId, outcome: r.outcome, record: serializeRecord(r.record) })),
});

export const serializeSessionAttendance = (s: SessionAttendanceDto) => ({
  sessionId: s.sessionId,
  teacher: s.teacher ? serializeRecord(s.teacher) : null,
  students: s.students.map(serializeRecord),
});
