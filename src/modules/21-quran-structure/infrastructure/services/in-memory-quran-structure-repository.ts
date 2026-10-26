import { pageOffset, type PageRequest, type SortDirection, type TransactionContext } from '../../../00-shared-kernel/public';
import type { QuranDatasetStore, QuranImportMetadata, QuranStructureRepository } from '../../application/ports/quran-structure-repository';
import type { Ayah, QuranDatasetInfo, QuranJuz, QuranLine, QuranPage, QuranQuarter, QuranQuarterMark, Surah, ValidatedQuranDataset } from '../../domain/entities/quran-structure';

/** In-memory implementation of both ports (unit and HTTP tests). Behaves like the SQL one: the whole dataset is replaced at once. */
export class InMemoryQuranStructureRepository implements QuranStructureRepository, QuranDatasetStore {
  private dataset: ValidatedQuranDataset | undefined;
  private active: QuranDatasetInfo | undefined;
  /** Every import ever made, newest last (the SQL table keeps the superseded ones too). */
  readonly imports: QuranDatasetInfo[] = [];

  async findActiveImport(_tx?: TransactionContext): Promise<QuranDatasetInfo | undefined> {
    return this.active;
  }
  async findActiveImportForUpdate(_tx: TransactionContext): Promise<QuranDatasetInfo | undefined> {
    return this.active;
  }

  async replaceDataset(dataset: ValidatedQuranDataset, metadata: QuranImportMetadata, _tx: TransactionContext): Promise<void> {
    this.dataset = dataset;
    this.active = {
      id: metadata.id,
      editionCode: dataset.editionCode,
      source: dataset.source,
      checksum: metadata.checksum,
      counts: { surahs: dataset.surahs.length, ayahs: dataset.ayahs.length, pages: dataset.pages.length, lines: dataset.lines.length, quarters: dataset.quarters.length, quarterMarks: dataset.quarterMarks.length },
      importedAt: metadata.importedAt,
    };
    this.imports.push(this.active);
  }

  async listSurahs(): Promise<Surah[]> {
    return [...(this.dataset?.surahs ?? [])];
  }
  async findSurah(number: number): Promise<Surah | undefined> {
    return this.dataset?.surahs.find((s) => s.number === number);
  }
  async findAyahByGlobal(globalAyah: number): Promise<Ayah | undefined> {
    return this.dataset?.ayahs[globalAyah - 1];
  }
  async findAyah(surah: number, ayah: number): Promise<Ayah | undefined> {
    return this.dataset?.ayahs.find((a) => a.surah === surah && a.ayah === ayah);
  }
  async listAyahsOfSurah(surah: number, request: PageRequest, direction: SortDirection): Promise<{ items: Ayah[]; total: number }> {
    const all = (this.dataset?.ayahs ?? []).filter((a) => a.surah === surah);
    const ordered = direction === 'desc' ? [...all].reverse() : all;
    return { items: ordered.slice(pageOffset(request), pageOffset(request) + request.pageSize), total: all.length };
  }
  async findPage(page: number): Promise<QuranPage | undefined> {
    return this.dataset?.pages.find((p) => p.page === page);
  }
  async listLinesOfPage(page: number): Promise<QuranLine[]> {
    return (this.dataset?.lines ?? []).filter((l) => l.page === page);
  }
  async findLineByGlobal(globalLine: number): Promise<QuranLine | undefined> {
    return this.dataset?.lines[globalLine - 1];
  }
  async listJuzs(): Promise<QuranJuz[]> {
    return [...(this.dataset?.juzs ?? [])];
  }
  async listQuarters(): Promise<QuranQuarter[]> {
    return [...(this.dataset?.quarters ?? [])];
  }
  async findQuarter(quarter: number): Promise<QuranQuarter | undefined> {
    return this.dataset?.quarters.find((q) => q.quarter === quarter);
  }
  async listQuarterMarks(): Promise<QuranQuarterMark[]> {
    return [...(this.dataset?.quarterMarks ?? [])];
  }
}
