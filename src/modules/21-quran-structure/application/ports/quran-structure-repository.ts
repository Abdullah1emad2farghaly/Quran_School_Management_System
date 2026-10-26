import type { PageRequest, SortDirection, TransactionContext } from '../../../00-shared-kernel/public';
import type { Ayah, QuranDatasetInfo, QuranJuz, QuranLine, QuranPage, QuranQuarter, QuranQuarterMark, Surah, ValidatedQuranDataset } from '../../domain/entities/quran-structure';

/** Read side. Reference data is immutable through the application: there is no write method here. */
export interface QuranStructureRepository {
  /** The ACTIVE import (attribution and counts), or undefined while nothing was imported. */
  findActiveImport(tx?: TransactionContext): Promise<QuranDatasetInfo | undefined>;
  listSurahs(): Promise<Surah[]>;
  findSurah(number: number): Promise<Surah | undefined>;
  findAyahByGlobal(globalAyah: number): Promise<Ayah | undefined>;
  findAyah(surah: number, ayah: number): Promise<Ayah | undefined>;
  listAyahsOfSurah(surah: number, request: PageRequest, direction: SortDirection): Promise<{ readonly items: Ayah[]; readonly total: number }>;
  findPage(page: number): Promise<QuranPage | undefined>;
  listLinesOfPage(page: number): Promise<QuranLine[]>;
  findLineByGlobal(globalLine: number): Promise<QuranLine | undefined>;
  listJuzs(): Promise<QuranJuz[]>;
  listQuarters(): Promise<QuranQuarter[]>;
  findQuarter(quarter: number): Promise<QuranQuarter | undefined>;
  listQuarterMarks(): Promise<QuranQuarterMark[]>;
}

export interface QuranImportMetadata {
  readonly id: string;
  readonly checksum: string;
  readonly importedAt: Date;
}

/** Write side, used ONLY by the import use case (the CLI); never by HTTP. */
export interface QuranDatasetStore {
  /** The ACTIVE import row, locked for the rest of the transaction. */
  findActiveImportForUpdate(tx: TransactionContext): Promise<QuranDatasetInfo | undefined>;
  /**
   * Replaces the whole dataset atomically inside `tx`: marks the active import SUPERSEDED, removes the old rows, inserts the new ones and
   * verifies the stored row counts against the dataset (throwing, so the caller's transaction rolls back, on any mismatch).
   */
  replaceDataset(dataset: ValidatedQuranDataset, metadata: QuranImportMetadata, tx: TransactionContext): Promise<void>;
}
