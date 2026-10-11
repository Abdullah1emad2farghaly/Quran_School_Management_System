import type { GeographyNode } from '../../domain/entities/geography-node';
import type { CenterKind, GeographyLevel, GeographyStatus } from '../../domain/value-objects/geography-level';

export interface GeographyNodeDto {
  readonly id: string;
  readonly level: GeographyLevel;
  readonly code: string;
  readonly name: string;
  readonly status: GeographyStatus;
  /** Parent node id (`null` for a country). */
  readonly parentId: string | null;
  /** Only for centers/cities. */
  readonly kind: CenterKind | null;
}

export const toGeographyNodeDto = (n: GeographyNode): GeographyNodeDto => ({
  id: n.id,
  level: n.level,
  code: n.code,
  name: n.name,
  status: n.status,
  parentId: n.parentId,
  kind: n.kind,
});

/** The resolved, consistent chain returned by hierarchy validation. */
export interface ValidatedGeography {
  readonly country: GeographyNodeDto;
  readonly governorate: GeographyNodeDto;
  readonly center: GeographyNodeDto | null;
  readonly village: GeographyNodeDto | null;
}
