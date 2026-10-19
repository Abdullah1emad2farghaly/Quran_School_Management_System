import type { ParentAddressDto, ParentDto, ParentSchoolLinkDto } from '../../application/dto/parent-dto';

const iso = (d: Date): string => d.toISOString();

const serializeAddress = (a: ParentAddressDto) => ({
  governorateId: a.governorateId,
  governorateName: a.governorateName,
  centerName: a.centerName,
  villageName: a.villageName,
  since: iso(a.since),
});

/** The public JSON of a Parent. The password (initial or chosen) and its hash never appear anywhere. */
export const serializeParent = (p: ParentDto) => ({
  id: p.id,
  userId: p.userId,
  organizationId: p.organizationId,
  name: p.name,
  phone: p.phone,
  address: p.address ? serializeAddress(p.address) : null,
  schoolIds: [...p.schoolIds],
  createdAt: iso(p.createdAt),
  updatedAt: iso(p.updatedAt),
});

export const serializeParentSchoolLink = (l: ParentSchoolLinkDto) => ({
  id: l.id,
  parentId: l.parentId,
  schoolId: l.schoolId,
  linkedAt: iso(l.linkedAt),
  linkedBy: l.linkedBy,
  unlinkedAt: l.unlinkedAt ? iso(l.unlinkedAt) : null,
  unlinkedBy: l.unlinkedBy,
  isActive: l.isActive,
});
