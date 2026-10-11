// Public contract of Module 14 (Geography): GLOBAL, shared reference data (not owned by any organization).
// Hierarchy (Master Specification §27): Country -> Governorate -> Center/City (one level, kind CENTER|CITY) -> Village.
// Several organizations can have schools in the same place: a school keeps its organization relationship and its
// geographic relationships separately; geography tables have no organization_id.
// Downstream modules (Unified Address 15, Schools 16) depend on `GeographyLookup` (read-only, incl. validateHierarchy) and
// may reference a level's `id` from their own tables with a Foreign Key (ON DELETE RESTRICT); they must not query these
// tables or import internals. No HTTP endpoints, no permissions, no delete/rename/reactivation, no outbox events.
export {
  GeographyService,
  type GeographyLookup,
  type HierarchyInput,
  type ValidateHierarchyOptions,
} from '../application/services/geography-service';
export type { GeographyNodeDto, ValidatedGeography } from '../application/dto/geography-dto';
export type { GeographyRepository } from '../application/ports/geography-repository';
export { SeedEgyptGeography, type SeedGeographySummary, type SeedEgyptGeographyDeps } from '../application/use-cases/seed-egypt-geography';
export { EGYPT_COUNTRY_NAME, EGYPT_GOVERNORATE_NAMES } from '../domain/reference/egypt-reference';
export {
  GEOGRAPHY_LEVELS,
  CENTER_KINDS,
  GEOGRAPHY_STATUSES,
  isGeographyLevel,
  isCenterKind,
  isGeographyStatus,
  type GeographyLevel,
  type CenterKind,
  type GeographyStatus,
} from '../domain/value-objects/geography-level';
export { formatGeographyCode, isGeographyCode } from '../domain/value-objects/geography-code';
export { normalizeGeographyName, GEOGRAPHY_NAME_MAX_LENGTH } from '../domain/value-objects/geography-name';
export { GeographyNode } from '../domain/entities/geography-node';
export { GeographyErrorCodes, geographyError, type GeographyErrorCode } from '../domain/errors/geography-errors';
export { GEOGRAPHY_ERROR_MESSAGES } from '../application/services/geography-error-messages';
export { InMemoryGeographyRepository } from '../infrastructure/services/in-memory-geography-repository';
export { SequelizeGeographyRepository } from '../infrastructure/persistence/sequelize/repositories/sequelize-geography-repository';
