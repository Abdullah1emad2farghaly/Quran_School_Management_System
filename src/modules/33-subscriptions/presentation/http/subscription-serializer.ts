import type { BulkCreationResultDto, CollectorDto, CollectorSchoolLinkDto, SubscriptionDto, SubscriptionViewDto } from '../../application/dto/subscription-dto';

const iso = (d: Date): string => d.toISOString();

/** The public JSON of a subscription: Student + Month + Status (and the audit instants). No amount exists. */
export const serializeSubscription = (s: SubscriptionDto | SubscriptionViewDto) => ({
  id: s.id,
  studentId: s.studentId,
  ...('studentName' in s ? { studentName: s.studentName } : {}),
  schoolId: s.schoolId,
  month: s.month,
  status: s.status,
  createdAt: iso(s.createdAt),
  paidAt: s.paidAt ? iso(s.paidAt) : null,
  waivedAt: s.waivedAt ? iso(s.waivedAt) : null,
  updatedAt: iso(s.updatedAt),
});

export const serializeBulkResult = (r: BulkCreationResultDto) => ({ batchId: r.batchId, schoolId: r.schoolId, month: r.month, count: r.count, createdAt: iso(r.createdAt) });

/** The password (initial or chosen) and its hash never appear anywhere. */
export const serializeCollector = (c: CollectorDto) => ({ userId: c.userId, organizationId: c.organizationId, name: c.name, phone: c.phone, schoolIds: [...c.schoolIds] });

export const serializeCollectorLink = (l: CollectorSchoolLinkDto) => ({
  id: l.id,
  userId: l.userId,
  schoolId: l.schoolId,
  linkedAt: iso(l.linkedAt),
  linkedBy: l.linkedBy,
  unlinkedAt: l.unlinkedAt ? iso(l.unlinkedAt) : null,
  unlinkedBy: l.unlinkedBy,
  isActive: l.isActive,
});
