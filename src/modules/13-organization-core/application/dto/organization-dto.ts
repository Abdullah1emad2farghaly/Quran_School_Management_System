import type { Organization } from '../../domain/entities/organization';
import type { OrganizationStatus } from '../../domain/value-objects/organization-status';

export interface OrganizationDto {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly status: OrganizationStatus;
  /** Primary key of the organization's country (`countries.id`); `null` until assigned. Immutable once set. */
  readonly countryId: string | null;
  /** The organization's own address (null only for an organization created before addresses existed). */
  readonly governorateId: string | null;
  /** Free text. */
  readonly centerName: string | null;
  readonly villageName: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export const toOrganizationDto = (o: Organization): OrganizationDto => ({
  id: o.id,
  code: o.code,
  name: o.name,
  status: o.status,
  countryId: o.countryId,
  governorateId: o.governorateId,
  centerName: o.centerName,
  villageName: o.villageName,
  createdAt: o.createdAt,
  updatedAt: o.updatedAt,
});
