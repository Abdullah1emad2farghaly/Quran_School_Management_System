import { newUuid, type Clock, type UnitOfWork } from '../../../00-shared-kernel/public';
import type { QuranSourceInfo, ValidatedQuranDataset } from '../../domain/entities/quran-structure';
import { quranError } from '../../domain/errors/quran-errors';
import { validateQuranDataset } from '../../domain/services/quran-dataset-validator';
import type { QuranDatasetStore } from '../ports/quran-structure-repository';

export type QuranImportOutcome = 'IMPORTED' | 'UNCHANGED' | 'REPLACED';

export interface QuranImportSummary {
  readonly outcome: QuranImportOutcome;
  readonly editionCode: string;
  readonly source: QuranSourceInfo;
  readonly checksum: string;
    readonly counts: { readonly surahs: number; readonly ayahs: number; readonly pages: number; readonly lines: number; readonly quarters: number; readonly quarterMarks: number };
}

export interface ImportQuranDatasetDeps {
  readonly store: QuranDatasetStore;
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
}

/**
 * The repeatable, idempotent import of the Quran dataset (only the CLI uses it).
 *  1. The WHOLE file is validated in memory first (`validateQuranDataset`): an incomplete / inconsistent / wrong-edition file throws
 *     QuranDatasetValidationError before the database is touched.
 *  2. In ONE transaction: the active import is locked; the same checksum is a no-op (UNCHANGED); a different dataset replaces the active one
 *     ONLY with `replace: true` (otherwise QURAN_DATASET_REPLACEMENT_NOT_CONFIRMED); the store verifies the stored counts and any failure
 *     rolls everything back, so an incomplete dataset can never replace a valid one.
 */
export class ImportQuranDataset {
  constructor(private readonly deps: ImportQuranDatasetDeps) {}

  async execute(input: { readonly raw: unknown; readonly checksum: string; readonly replace: boolean }, validate: (raw: unknown) => ValidatedQuranDataset = validateQuranDataset): Promise<QuranImportSummary> {
    const dataset = validate(input.raw);
    const counts = { surahs: dataset.surahs.length, ayahs: dataset.ayahs.length, pages: dataset.pages.length, lines: dataset.lines.length, quarters: dataset.quarters.length, quarterMarks: dataset.quarterMarks.length };
    const summary = (outcome: QuranImportOutcome): QuranImportSummary => ({ outcome, editionCode: dataset.editionCode, source: dataset.source, checksum: input.checksum, counts });

    return this.deps.unitOfWork.run(async (tx) => {
      const active = await this.deps.store.findActiveImportForUpdate(tx);
      if (active && active.checksum === input.checksum) return summary('UNCHANGED');
      if (active && !input.replace) throw quranError('QURAN_DATASET_REPLACEMENT_NOT_CONFIRMED');
      await this.deps.store.replaceDataset(dataset, { id: newUuid(), checksum: input.checksum, importedAt: this.deps.clock.now() }, tx);
      return summary(active ? 'REPLACED' : 'IMPORTED');
    });
  }
}
