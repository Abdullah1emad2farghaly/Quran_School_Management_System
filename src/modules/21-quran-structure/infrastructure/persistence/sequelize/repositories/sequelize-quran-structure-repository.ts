import { QueryTypes, type Sequelize } from 'sequelize';
import { pageOffset, type PageRequest, type SortDirection, type TransactionContext } from '../../../../../00-shared-kernel/public';
import { sequelizeTransactionOf } from '../../../../../02-database/public';
import type { QuranDatasetStore, QuranImportMetadata, QuranStructureRepository } from '../../../../application/ports/quran-structure-repository';
import type { Ayah, QuranDatasetInfo, QuranJuz, QuranLine, QuranPage, QuranQuarter, QuranQuarterMark, Surah, ValidatedQuranDataset } from '../../../../domain/entities/quran-structure';
import { juzOfQuarter, type JuzVerification, type LineKind } from '../../../../domain/value-objects/quran-edition';

type Queryable = Pick<Sequelize, 'query'>;
const CHUNK = 400;
const asDate = (value: Date | string): Date => (value instanceof Date ? value : new Date(value));
const n = (value: unknown): number => Number(value);
const nOrNull = (value: unknown): number | null => (value === null || value === undefined ? null : Number(value));

interface ImportRow {
  id: string; editionCode: string; sourceProvider: string; sourceName: string; sourceVersion: string | null; sourceUrl: string | null; sourceLicense: string | null; sourceRetrievedOn: string | null;
  sourceFilesJson: string | null; checksum: string; surahCount: number; ayahCount: number; pageCount: number; lineCount: number; quarterCount: number; quarterMarkCount: number; importedAt: Date | string;
}
const IMPORT_SELECT = `SELECT id, edition_code AS editionCode, source_provider AS sourceProvider, source_name AS sourceName, source_version AS sourceVersion, source_url AS sourceUrl,
  source_license AS sourceLicense, source_retrieved_on AS sourceRetrievedOn, source_files_json AS sourceFilesJson, checksum, surah_count AS surahCount, ayah_count AS ayahCount,
  page_count AS pageCount, line_count AS lineCount, quarter_count AS quarterCount, quarter_mark_count AS quarterMarkCount, imported_at AS importedAt FROM quran_dataset_imports WHERE active = 1`;
/** `source_files_json` holds { files, attributions } (an older shape was the bare files array). */
function parseSourceJson(json: string | null): { files: Array<{ name: string; sha256: string }>; attributions: QuranDatasetInfo['source']['attributions'] } {
  if (!json) return { files: [], attributions: [] };
  const parsed: unknown = JSON.parse(json);
  if (Array.isArray(parsed)) return { files: parsed as Array<{ name: string; sha256: string }>, attributions: [] };
  const o = parsed as { files?: Array<{ name: string; sha256: string }>; attributions?: QuranDatasetInfo['source']['attributions'] };
  return { files: o.files ?? [], attributions: o.attributions ?? [] };
}
const toInfo = (r: ImportRow): QuranDatasetInfo => ({
  id: r.id,
  editionCode: r.editionCode,
  source: { provider: r.sourceProvider, name: r.sourceName, version: r.sourceVersion, url: r.sourceUrl, license: r.sourceLicense, retrievedOn: r.sourceRetrievedOn, ...parseSourceJson(r.sourceFilesJson) },
  checksum: r.checksum,
  counts: { surahs: n(r.surahCount), ayahs: n(r.ayahCount), pages: n(r.pageCount), lines: n(r.lineCount), quarters: n(r.quarterCount), quarterMarks: n(r.quarterMarkCount) },
  importedAt: asDate(r.importedAt),
});

const AYAH_SELECT = `SELECT global_ayah AS globalAyah, surah_number AS surah, ayah_number AS ayah, ayah_text AS text, first_page AS firstPage, first_line AS firstLine,
  last_page AS lastPage, last_line AS lastLine, juz_number AS juz, quarter_number AS quarter, has_rub_marker AS startsRubMarker FROM quran_ayahs`;
const toAyah = (r: Record<string, unknown>): Ayah => ({
  globalAyah: n(r.globalAyah), surah: n(r.surah), ayah: n(r.ayah), text: String(r.text),
  firstPage: n(r.firstPage), firstLine: n(r.firstLine), lastPage: n(r.lastPage), lastLine: n(r.lastLine), juz: n(r.juz), quarter: n(r.quarter), startsRubMarker: Boolean(r.startsRubMarker),
});
const LINE_SELECT = `SELECT global_line AS globalLine, page_number AS page, line_number AS line, kind, surah_number AS surah, first_global_ayah AS firstGlobalAyah,
  last_global_ayah AS lastGlobalAyah FROM quran_lines`;
const toLine = (r: Record<string, unknown>): QuranLine => ({
  globalLine: n(r.globalLine), page: n(r.page), line: n(r.line), kind: r.kind as LineKind, surah: nOrNull(r.surah), firstGlobalAyah: nOrNull(r.firstGlobalAyah), lastGlobalAyah: nOrNull(r.lastGlobalAyah),
});
const QUARTER_SELECT = 'SELECT quarter_number AS quarter, hizb_number AS hizb, start_global_ayah AS startGlobalAyah, start_surah_number AS startSurah, start_ayah_number AS startAyah FROM quran_quarters';
const toQuarter = (r: Record<string, unknown>): QuranQuarter => ({ quarter: n(r.quarter), hizb: n(r.hizb), startGlobalAyah: n(r.startGlobalAyah), startSurah: n(r.startSurah), startAyah: n(r.startAyah) });

export class SequelizeQuranStructureRepository implements QuranStructureRepository, QuranDatasetStore {
  constructor(private readonly db: Queryable) {}

  private select<T extends object>(sql: string, replacements: Record<string, unknown> | unknown[] = {}, tx?: TransactionContext): Promise<T[]> {
    return this.db.query<T>(sql, { replacements: replacements as never, type: QueryTypes.SELECT, transaction: sequelizeTransactionOf(tx) ?? null });
  }

  // ----- reads -----
  async findActiveImport(tx?: TransactionContext): Promise<QuranDatasetInfo | undefined> {
    const rows = await this.select<ImportRow>(`${IMPORT_SELECT} LIMIT 1`, {}, tx);
    return rows[0] ? toInfo(rows[0]) : undefined;
  }

  async listSurahs(): Promise<Surah[]> {
    const rows = await this.select<Record<string, unknown>>('SELECT surah_number AS number, name_ar AS nameAr, ayah_count AS ayahCount, first_global_ayah AS firstGlobalAyah FROM quran_surahs ORDER BY surah_number ASC');
    return rows.map((r) => ({ number: n(r.number), nameAr: String(r.nameAr), ayahCount: n(r.ayahCount), firstGlobalAyah: n(r.firstGlobalAyah) }));
  }
  async findSurah(number: number): Promise<Surah | undefined> {
    return (await this.listSurahsWhere('WHERE surah_number = :number', { number }))[0];
  }
  private async listSurahsWhere(where: string, replacements: Record<string, unknown>): Promise<Surah[]> {
    const rows = await this.select<Record<string, unknown>>(`SELECT surah_number AS number, name_ar AS nameAr, ayah_count AS ayahCount, first_global_ayah AS firstGlobalAyah FROM quran_surahs ${where}`, replacements);
    return rows.map((r) => ({ number: n(r.number), nameAr: String(r.nameAr), ayahCount: n(r.ayahCount), firstGlobalAyah: n(r.firstGlobalAyah) }));
  }

  async findAyahByGlobal(globalAyah: number): Promise<Ayah | undefined> {
    const rows = await this.select<Record<string, unknown>>(`${AYAH_SELECT} WHERE global_ayah = :globalAyah`, { globalAyah });
    return rows[0] ? toAyah(rows[0]) : undefined;
  }
  async findAyah(surah: number, ayah: number): Promise<Ayah | undefined> {
    const rows = await this.select<Record<string, unknown>>(`${AYAH_SELECT} WHERE surah_number = :surah AND ayah_number = :ayah`, { surah, ayah });
    return rows[0] ? toAyah(rows[0]) : undefined;
  }
  async listAyahsOfSurah(surah: number, request: PageRequest, direction: SortDirection): Promise<{ items: Ayah[]; total: number }> {
    const order = direction === 'desc' ? 'DESC' : 'ASC'; // a fixed keyword, never user input
    const rows = await this.select<Record<string, unknown>>(`${AYAH_SELECT} WHERE surah_number = :surah ORDER BY ayah_number ${order} LIMIT :limit OFFSET :offset`, { surah, limit: request.pageSize, offset: pageOffset(request) });
    const total = await this.select<{ total: number }>('SELECT COUNT(*) AS total FROM quran_ayahs WHERE surah_number = :surah', { surah });
    return { items: rows.map(toAyah), total: n(total[0]?.total ?? 0) };
  }

  async findPage(page: number): Promise<QuranPage | undefined> {
    const rows = await this.select<Record<string, unknown>>('SELECT page_number AS page, line_count AS lineCount, first_global_ayah AS firstGlobalAyah, last_global_ayah AS lastGlobalAyah FROM quran_pages WHERE page_number = :page', { page });
    const r = rows[0];
    return r ? { page: n(r.page), lineCount: n(r.lineCount), firstGlobalAyah: n(r.firstGlobalAyah), lastGlobalAyah: n(r.lastGlobalAyah) } : undefined;
  }
  async listLinesOfPage(page: number): Promise<QuranLine[]> {
    return (await this.select<Record<string, unknown>>(`${LINE_SELECT} WHERE page_number = :page ORDER BY line_number ASC`, { page })).map(toLine);
  }
  async findLineByGlobal(globalLine: number): Promise<QuranLine | undefined> {
    const rows = await this.select<Record<string, unknown>>(`${LINE_SELECT} WHERE global_line = :globalLine`, { globalLine });
    return rows[0] ? toLine(rows[0]) : undefined;
  }

  async listJuzs(): Promise<QuranJuz[]> {
    const rows = await this.select<Record<string, unknown>>('SELECT juz_number AS juz, verification, start_global_ayah AS startGlobalAyah, start_surah_number AS startSurah, start_ayah_number AS startAyah FROM quran_juz ORDER BY juz_number ASC');
    return rows.map((r) => ({ juz: n(r.juz), verification: r.verification as JuzVerification, startGlobalAyah: n(r.startGlobalAyah), startSurah: n(r.startSurah), startAyah: n(r.startAyah) }));
  }
  async listQuarters(): Promise<QuranQuarter[]> {
    return (await this.select<Record<string, unknown>>(`${QUARTER_SELECT} ORDER BY quarter_number ASC`)).map(toQuarter);
  }
  async findQuarter(quarter: number): Promise<QuranQuarter | undefined> {
    const rows = await this.select<Record<string, unknown>>(`${QUARTER_SELECT} WHERE quarter_number = :quarter`, { quarter });
    return rows[0] ? toQuarter(rows[0]) : undefined;
  }
  async listQuarterMarks(): Promise<QuranQuarterMark[]> {
    const rows = await this.select<Record<string, unknown>>('SELECT mark_number AS mark, start_global_ayah AS startGlobalAyah, start_surah_number AS startSurah, start_ayah_number AS startAyah FROM quran_quarter_marks ORDER BY mark_number ASC');
    return rows.map((r) => ({ mark: n(r.mark), startGlobalAyah: n(r.startGlobalAyah), startSurah: n(r.startSurah), startAyah: n(r.startAyah) }));
  }

  // ----- write side (import only) -----
  async findActiveImportForUpdate(tx: TransactionContext): Promise<QuranDatasetInfo | undefined> {
    const rows = await this.select<ImportRow>(`${IMPORT_SELECT} LIMIT 1 FOR UPDATE`, {}, tx);
    return rows[0] ? toInfo(rows[0]) : undefined;
  }

  async replaceDataset(dataset: ValidatedQuranDataset, metadata: QuranImportMetadata, tx: TransactionContext): Promise<void> {
    const transaction = sequelizeTransactionOf(tx) ?? null;
    const run = (sql: string, replacements: unknown[] = []) => this.db.query(sql, { replacements: replacements as never, transaction });
    const insert = async (table: string, columns: string[], rows: unknown[][]): Promise<void> => {
      for (let i = 0; i < rows.length; i += CHUNK) {
        const chunk = rows.slice(i, i + CHUNK);
        const placeholders = chunk.map(() => `(${columns.map(() => '?').join(', ')})`).join(', ');
        await run(`INSERT INTO ${table} (${columns.join(', ')}) VALUES ${placeholders}`, chunk.flat());
      }
    };

    // The previous dataset stays as a SUPERSEDED import row (attribution history); its data rows are replaced.
    await run("UPDATE quran_dataset_imports SET status = 'SUPERSEDED', active = NULL, superseded_at = ? WHERE active = 1", [metadata.importedAt]);
    // quran_hizb is RESERVED (empty) for exact hizb boundaries of a future version: V1 neither reads nor writes it.
    for (const table of ['quran_lines', 'quran_pages', 'quran_ayahs', 'quran_quarters', 'quran_quarter_marks', 'quran_juz', 'quran_surahs']) await run(`DELETE FROM ${table}`);

    await insert('quran_surahs', ['surah_number', 'name_ar', 'ayah_count', 'first_global_ayah'], dataset.surahs.map((s) => [s.number, s.nameAr, s.ayahCount, s.firstGlobalAyah]));
    await insert('quran_juz', ['juz_number', 'verification', 'start_global_ayah', 'start_surah_number', 'start_ayah_number'], dataset.juzs.map((j) => [j.juz, j.verification, j.startGlobalAyah, j.startSurah, j.startAyah]));
    // quran_quarters.juz_number is the arithmetic position of the quarter (8 per juz) that the table's CHECK requires; it is not the juz of quran_juz
    await insert('quran_quarters', ['quarter_number', 'hizb_number', 'juz_number', 'start_global_ayah', 'start_surah_number', 'start_ayah_number'], dataset.quarters.map((q) => [q.quarter, q.hizb, juzOfQuarter(q.quarter), q.startGlobalAyah, q.startSurah, q.startAyah]));
    await insert('quran_quarter_marks', ['mark_number', 'start_global_ayah', 'start_surah_number', 'start_ayah_number'], dataset.quarterMarks.map((m) => [m.mark, m.startGlobalAyah, m.startSurah, m.startAyah]));
    await insert('quran_pages', ['page_number', 'line_count', 'first_global_ayah', 'last_global_ayah'], dataset.pages.map((p) => [p.page, p.lineCount, p.firstGlobalAyah, p.lastGlobalAyah]));
    await insert(
      'quran_ayahs',
      ['global_ayah', 'surah_number', 'ayah_number', 'ayah_text', 'first_page', 'first_line', 'last_page', 'last_line', 'juz_number', 'quarter_number', 'has_rub_marker'],
      dataset.ayahs.map((a) => [a.globalAyah, a.surah, a.ayah, a.text, a.firstPage, a.firstLine, a.lastPage, a.lastLine, a.juz, a.quarter, a.startsRubMarker ? 1 : 0]),
    );
    await insert(
      'quran_lines',
      ['global_line', 'page_number', 'line_number', 'kind', 'surah_number', 'first_global_ayah', 'last_global_ayah'],
      dataset.lines.map((l) => [l.globalLine, l.page, l.line, l.kind, l.surah, l.firstGlobalAyah, l.lastGlobalAyah]),
    );

    // Completeness check inside the same transaction: any mismatch throws and the caller's unit of work rolls EVERYTHING back (the old dataset survives).
    const expected: Array<[string, number]> = [['quran_surahs', dataset.surahs.length], ['quran_ayahs', dataset.ayahs.length], ['quran_pages', dataset.pages.length], ['quran_lines', dataset.lines.length], ['quran_quarters', dataset.quarters.length], ['quran_quarter_marks', dataset.quarterMarks.length], ['quran_juz', dataset.juzs.length]];
    for (const [table, count] of expected) {
      const rows = await this.select<{ total: number }>(`SELECT COUNT(*) AS total FROM ${table}`, {}, tx);
      if (n(rows[0]?.total) !== count) throw new Error(`Quran import verification failed: ${table} holds ${n(rows[0]?.total)} rows, expected ${count}.`);
    }

    await insert(
      'quran_dataset_imports',
      ['id', 'edition_code', 'source_provider', 'source_name', 'source_version', 'source_url', 'source_license', 'source_retrieved_on', 'source_files_json', 'checksum', 'surah_count', 'ayah_count', 'page_count', 'line_count', 'quarter_count', 'quarter_mark_count', 'status', 'active', 'imported_at'],
      [[metadata.id, dataset.editionCode, dataset.source.provider, dataset.source.name, dataset.source.version, dataset.source.url, dataset.source.license, dataset.source.retrievedOn, JSON.stringify({ files: dataset.source.files, attributions: dataset.source.attributions }), metadata.checksum, dataset.surahs.length, dataset.ayahs.length, dataset.pages.length, dataset.lines.length, dataset.quarters.length, dataset.quarterMarks.length, 'ACTIVE', 1, metadata.importedAt]],
    );
  }
}
