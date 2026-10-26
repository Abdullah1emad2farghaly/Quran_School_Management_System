// Public contract of Module 21 (Quran Structure): IMMUTABLE reference data of the approved edition (Madinah Mushaf, Hafs from Asim, 604 pages):
// surahs, ayahs, pages/faces with their lines, juz, hizb and quarters, and the global position of the canonical order. Other modules (Module 22
// Range Engine, schedules, sessions, memorization...) depend on `QuranStructureLookup` (read-only) and reference positions by NUMBER (surah, ayah,
// global position, page, line, quarter), never with a foreign key into these tables and never through their internals. Read-only REST endpoints under
// /quran; permission `quran.structure.read` granted to every assignable role (all authenticated users). The data is loaded only by
// `npm run import:quran` (repeatable and idempotent); there is no write API and no domain event.
export * from '../domain/value-objects/quran-edition';
export type * from '../domain/entities/quran-structure';
export { QuranErrorCodes, quranError, QuranDatasetValidationError, type QuranErrorCode } from '../domain/errors/quran-errors';
export { validateQuranDataset, DATASET_FORMAT, DATASET_FORMAT_VERSION, MAX_REPORTED_PROBLEMS } from '../domain/services/quran-dataset-validator';
export { QuranStructureService, type QuranStructureLookup } from '../application/services/quran-structure-service';
export { QuranPermissions, registerQuranAuthorization } from '../application/services/quran-authorization';
export { QURAN_ERROR_MESSAGES } from '../application/services/quran-error-messages';
export { ImportQuranDataset, type ImportQuranDatasetDeps, type QuranImportSummary, type QuranImportOutcome } from '../application/use-cases/import-quran-dataset';
export type { QuranStructureRepository, QuranDatasetStore, QuranImportMetadata } from '../application/ports/quran-structure-repository';
export type * from '../application/dto/quran-dto';
export { InMemoryQuranStructureRepository } from '../infrastructure/services/in-memory-quran-structure-repository';
export { convertKfgqpcHafsPackage, serializeDataset, APPROVED_KFGQPC_HAFS_PACKAGES, KFGQPC_SOURCE_URL, KFGQPC_LICENSE_STATUS, type ConversionReport, type ConversionResult, type JuzEvidence } from '../infrastructure/source/kfgqpc-hafs-v30-converter';
export { APPROVED_TANZIL_QUARTER_FILES, readTanzilQuarters, type TanzilQuarterFile } from '../infrastructure/source/tanzil-quarters-reader';
export { SequelizeQuranStructureRepository } from '../infrastructure/persistence/sequelize/repositories/sequelize-quran-structure-repository';
export { createQuranRouter, QURAN_AYAHS_SPEC, type QuranRouterDeps } from '../presentation/http/quran-routes';
export { quranApiDoc } from '../presentation/http/quran.openapi';
