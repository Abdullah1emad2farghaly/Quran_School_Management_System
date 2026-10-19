import type { Parent } from '../../domain/entities/parent';
import type { ParentSchoolLink } from '../../domain/entities/parent-school-link';
import type { ParentAddressEntry } from '../ports/parent-repository';

export interface ParentAddressDto {
  readonly governorateId: string;
  /** The Governorate name as stored with this address (a snapshot; stays readable if the Governorate is renamed or deactivated). */
  readonly governorateName: string;
  readonly centerName: string | null;
  readonly villageName: string | null;
  readonly since: Date;
}

export interface ParentDto {
  readonly id: string;
  readonly userId: string;
  readonly organizationId: string;
  readonly name: string;
  /** The normalized phone (the login identity, Module 08). */
  readonly phone: string;
  /** The CURRENT address; null only if the record has none (never for a normally registered Parent). */
  readonly address: ParentAddressDto | null;
  /** The schools this Parent is currently linked to. */
  readonly schoolIds: readonly string[];
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface ParentSchoolLinkDto {
  readonly id: string;
  readonly parentId: string;
  readonly schoolId: string;
  readonly linkedAt: Date;
  readonly linkedBy: string;
  readonly unlinkedAt: Date | null;
  readonly unlinkedBy: string | null;
  readonly isActive: boolean;
}

export const toParentAddressDto = (e: ParentAddressEntry): ParentAddressDto => ({
  governorateId: e.governorateId,
  governorateName: e.governorateName,
  centerName: e.centerName,
  villageName: e.villageName,
  since: e.createdAt,
});

export function toParentDto(input: { parent: Parent; phone: string; address: ParentAddressEntry | undefined; links: readonly ParentSchoolLink[] }): ParentDto {
  const s = input.parent.snapshot;
  return {
    id: s.id,
    userId: s.userId,
    organizationId: s.organizationId,
    name: s.fullName,
    phone: input.phone,
    address: input.address ? toParentAddressDto(input.address) : null,
    schoolIds: input.links.filter((l) => l.isActive).map((l) => l.snapshot.schoolId),
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}

export function toParentSchoolLinkDto(link: ParentSchoolLink): ParentSchoolLinkDto {
  const s = link.snapshot;
  return { id: s.id, parentId: s.parentId, schoolId: s.schoolId, linkedAt: s.linkedAt, linkedBy: s.linkedBy, unlinkedAt: s.unlinkedAt, unlinkedBy: s.unlinkedBy, isActive: link.isActive };
}
