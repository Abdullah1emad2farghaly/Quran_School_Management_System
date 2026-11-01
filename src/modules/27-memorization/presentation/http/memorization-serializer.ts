import type { AssignmentDto, RecordBatchResultDto, RecordCorrectionResultDto, RecordDto, SessionMemorizationDto } from '../../application/dto/memorization-dto';

const iso = (d: Date): string => d.toISOString();

export const serializeAssignment = (a: AssignmentDto) => ({
  id: a.id,
  schoolId: a.schoolId,
  groupId: a.groupId,
  studentId: a.studentId,
  definedInSessionId: a.definedInSessionId,
  definedByUserId: a.definedByUserId,
  range: a.range,
  status: a.status,
  createdAt: iso(a.createdAt),
  updatedAt: iso(a.updatedAt),
});

export const serializeRecord = (r: RecordDto) => ({
  id: r.id,
  sessionId: r.sessionId,
  schoolId: r.schoolId,
  groupId: r.groupId,
  studentId: r.studentId,
  assignmentId: r.assignmentId,
  range: r.range,
  matchesAssignment: r.matchesAssignment,
  recordedBy: r.recordedBy,
  recordedAt: iso(r.recordedAt),
  updatedBy: r.updatedBy,
  updatedAt: iso(r.updatedAt),
});

export const serializeSession = (s: SessionMemorizationDto) => ({
  sessionId: s.sessionId,
  scheduled: s.scheduled.map(serializeAssignment),
  defined: s.defined.map(serializeAssignment),
  records: s.records.map(serializeRecord),
});

export const serializeBatch = (b: RecordBatchResultDto) => ({
  sessionId: b.sessionId,
  results: b.results.map((r) => ({ studentId: r.studentId, outcome: r.outcome, record: serializeRecord(r.record) })),
});

export const serializeCorrection = (c: RecordCorrectionResultDto) => ({ outcome: c.outcome, record: serializeRecord(c.record) });
