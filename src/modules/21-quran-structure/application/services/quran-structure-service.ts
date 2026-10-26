import { buildPageResult, type PageRequest, type PageResult, type SortDirection } from '../../../00-shared-kernel/public';
import type { Ayah, QuranDatasetInfo, QuranDivisionStart, QuranJuz, QuranLine, QuranQuarter } from '../../domain/entities/quran-structure';
import { quranError } from '../../domain/errors/quran-errors';
import { QURAN_QUARTER_COUNT, ayahPositionOf, hizbOfQuarter } from '../../domain/value-objects/quran-edition';
import type { AyahDto, AyahRefDto, JuzDto, LineDto, PageDto, QuarterDto, QuarterMarkDto, QuranDatasetInfoDto, SurahDto } from '../dto/quran-dto';
import type { QuranStructureRepository } from '../ports/quran-structure-repository';

/**
 * THE read-only contract of Module 21 for other modules (Module 22 Range Engine, Group Schedules, Sessions, Memorization...). Positions:
 *  - ayah:    `globalPosition` 1..6236 in the canonical order (surah then ayah), `getAyahByGlobalPosition` / `getAyah(surah, ayah)`;
 *  - line:    `globalLine` 1..N in page then line order (banner and basmala lines included), `getLineByGlobalIndex`; a TEXT line names the first and
 *             last ayah it touches (an ayah can continue from / into the neighbouring lines);
 *  - page:    1..604 (a page / face), `getPage` with its lines;
 *  - juz:     1..30 with the official KFGQPC Excel `jozz` start (and, informationally, its relation to the printed markers);
 *  - quarter: 1..240 (rub' al-hizb) with its hizb, from the approved quarter source; the juz and the quarters come from different approved
 *             sources and are not reconciled (docs/QURAN-STRUCTURE.md); printed quarter markers are evidence about the text, not quarter positions.
 * Every method except `getDatasetInfo` throws QURAN_DATASET_NOT_IMPORTED while nothing is imported (a consumer never silently gets an empty
 * Quran); `get*` answers undefined for a number outside the structure. The data cannot be changed through this contract.
 */
export interface QuranStructureLookup {
  getDatasetInfo(): Promise<QuranDatasetInfoDto | undefined>;
  listSurahs(): Promise<SurahDto[]>;
  getSurah(number: number): Promise<SurahDto | undefined>;
  getAyah(surah: number, ayah: number): Promise<AyahDto | undefined>;
  getAyahByGlobalPosition(globalPosition: number): Promise<AyahDto | undefined>;
  listAyahsOfSurah(surah: number, request: PageRequest, direction?: SortDirection): Promise<PageResult<AyahDto>>;
  getPage(page: number): Promise<PageDto | undefined>;
  getLineByGlobalIndex(globalLine: number): Promise<LineDto | undefined>;
  listJuzs(): Promise<JuzDto[]>;
  listQuarters(): Promise<QuarterDto[]>;
  getQuarter(quarter: number): Promise<QuarterDto | undefined>;
  listQuarterMarks(): Promise<QuarterMarkDto[]>;
}

const ref = (globalPosition: number): AyahRefDto => {
  const position = ayahPositionOf(globalPosition)!;
  return { surah: position.surah, ayah: position.ayah, globalPosition };
};
const refOrNull = (globalPosition: number | null): AyahRefDto | null => (globalPosition === null ? null : ref(globalPosition));
const toQuarter = (q: QuranQuarter): QuarterDto => ({ quarter: q.quarter, hizb: q.hizb, start: startOf(q) });
const startOf = (d: QuranDivisionStart): AyahRefDto => ({ surah: d.startSurah, ayah: d.startAyah, globalPosition: d.startGlobalAyah });

const toAyah = (a: Ayah): AyahDto => ({ globalPosition: a.globalAyah, surah: a.surah, ayah: a.ayah, text: a.text, firstPage: a.firstPage, firstLine: a.firstLine, lastPage: a.lastPage, lastLine: a.lastLine, juz: a.juz, quarter: a.quarter, hizb: hizbOfQuarter(a.quarter), startsRubMarker: a.startsRubMarker });
const toLine = (l: QuranLine): LineDto => ({ globalLine: l.globalLine, page: l.page, line: l.line, kind: l.kind, surah: l.surah, firstAyah: refOrNull(l.firstGlobalAyah), lastAyah: refOrNull(l.lastGlobalAyah) });
const toInfo = (i: QuranDatasetInfo, juzs: readonly QuranJuz[]): QuranDatasetInfoDto => ({
  editionCode: i.editionCode,
  source: i.source,
  checksum: i.checksum,
  counts: i.counts,
  coverage: {
    quarters: { expected: QURAN_QUARTER_COUNT, imported: i.counts.quarters },
    printedQuarterMarkers: i.counts.quarterMarks,
    juz: {
      total: juzs.length,
      markerConfirmed: juzs.filter((j) => j.verification === 'MARKER_CONFIRMED').length,
      surahStartNoMarker: juzs.filter((j) => j.verification === 'SURAH_START_NO_MARKER').length,
      markerConflict: juzs.filter((j) => j.verification === 'MARKER_CONFLICT').length,
    },
  },
  importedAt: i.importedAt.toISOString(),
});

export class QuranStructureService implements QuranStructureLookup {
  constructor(private readonly repository: QuranStructureRepository) {}

  async getDatasetInfo(): Promise<QuranDatasetInfoDto | undefined> {
    const info = await this.repository.findActiveImport();
    return info ? toInfo(info, await this.repository.listJuzs()) : undefined;
  }

  async listSurahs(): Promise<SurahDto[]> {
    await this.ensureImported();
    return (await this.repository.listSurahs()).map((s) => ({ number: s.number, nameAr: s.nameAr, ayahCount: s.ayahCount, firstGlobalPosition: s.firstGlobalAyah }));
  }

  async getSurah(number: number): Promise<SurahDto | undefined> {
    await this.ensureImported();
    const s = await this.repository.findSurah(number);
    return s ? { number: s.number, nameAr: s.nameAr, ayahCount: s.ayahCount, firstGlobalPosition: s.firstGlobalAyah } : undefined;
  }

  async getAyah(surah: number, ayah: number): Promise<AyahDto | undefined> {
    await this.ensureImported();
    const a = await this.repository.findAyah(surah, ayah);
    return a ? toAyah(a) : undefined;
  }

  async getAyahByGlobalPosition(globalPosition: number): Promise<AyahDto | undefined> {
    await this.ensureImported();
    const a = await this.repository.findAyahByGlobal(globalPosition);
    return a ? toAyah(a) : undefined;
  }

  async listAyahsOfSurah(surah: number, request: PageRequest, direction: SortDirection = 'asc'): Promise<PageResult<AyahDto>> {
    await this.ensureImported();
    const { items, total } = await this.repository.listAyahsOfSurah(surah, request, direction);
    return buildPageResult(items.map(toAyah), total, request);
  }

  async getPage(page: number): Promise<PageDto | undefined> {
    await this.ensureImported();
    const found = await this.repository.findPage(page);
    if (!found) return undefined;
    const lines = await this.repository.listLinesOfPage(page);
    return { page: found.page, lineCount: found.lineCount, firstAyah: ref(found.firstGlobalAyah), lastAyah: ref(found.lastGlobalAyah), lines: lines.map(toLine) };
  }

  async getLineByGlobalIndex(globalLine: number): Promise<LineDto | undefined> {
    await this.ensureImported();
    const l = await this.repository.findLineByGlobal(globalLine);
    return l ? toLine(l) : undefined;
  }

  async listJuzs(): Promise<JuzDto[]> {
    await this.ensureImported();
    return (await this.repository.listJuzs()).map((j) => ({ juz: j.juz, start: startOf(j), verification: j.verification }));
  }

  async listQuarters(): Promise<QuarterDto[]> {
    await this.ensureImported();
    return (await this.repository.listQuarters()).map(toQuarter);
  }

  async getQuarter(quarter: number): Promise<QuarterDto | undefined> {
    await this.ensureImported();
    const q = await this.repository.findQuarter(quarter);
    return q ? toQuarter(q) : undefined;
  }

  async listQuarterMarks(): Promise<QuarterMarkDto[]> {
    await this.ensureImported();
    return (await this.repository.listQuarterMarks()).map((m) => ({ mark: m.mark, start: startOf(m) }));
  }

  private async ensureImported(): Promise<void> {
    if (!(await this.repository.findActiveImport())) throw quranError('QURAN_DATASET_NOT_IMPORTED');
  }
}
