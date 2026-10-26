import { createHash } from 'node:crypto';
import { QuranDatasetValidationError } from '../../domain/errors/quran-errors';
import { MAX_REPORTED_PROBLEMS } from '../../domain/services/quran-dataset-validator';
import { AYAH_END_MARK, QURAN_AYAH_COUNT, QURAN_JUZ_COUNT, QURAN_PAGE_COUNT, QURAN_SURAH_COUNT, RUB_EL_HIZB_MARK, SURAH_AYAH_COUNTS, SURAHS_WITHOUT_BASMALA_LINE, ayahPositionOf, globalPositionOf } from '../../domain/value-objects/quran-edition';
import { readDocxLines, type DocxLine } from './docx-layout-reader';
import { APPROVED_TANZIL_QUARTER_FILES, readTanzilQuarters } from './tanzil-quarters-reader';
import { readXlsxFirstSheet } from './xlsx-sheet-reader';
import { readZip } from './zip-reader';

/**
 * The approved sources of Module 21 V1 (project owner decisions):
 *  - the official King Fahd Glorious Quran Printing Complex package `kfgqpc_hafs_v30.zip`: the Quran text, the official page/line layout (CSV, JSON, DOCX) and
 *    the juz of every ayah (the Excel file's `jozz` values, used exactly as stated, never recalculated or corrected);
 *  - the supplied Tanzil `quran-data.xml`: ALL 240 quarter (rub' al-hizb) records, followed exactly in every disagreement with the package.
 * Each file is pinned by SHA-256: a different file is refused until it is added deliberately (a reviewed code change). The sources are never combined
 * to fill or correct one another: where they disagree (the juz starts versus the first quarter of a juz) both are stored as their source states them.
 * The package SHA-256 is the value published by the Complex on https://qurancomplex.gov.sa/quran-dev/.
 */
export const APPROVED_KFGQPC_HAFS_PACKAGES: ReadonlyArray<{ readonly fileName: string; readonly sha256: string; readonly version: string }> = Object.freeze([
  { fileName: 'kfgqpc_hafs_v30.zip', sha256: '227e6b1564d980f2bd09c2c35ebfb0330ac268c79a7c247cd1ab665bc635f245', version: 'kfgqpc_hafs_v30 (update 15.0, modified 2026-09-30)' },
]);
export const KFGQPC_SOURCE_URL = 'https://qurancomplex.gov.sa/quran-dev/';
/** Status of the usage terms: what is known, without claiming more (the owner is clarifying redistribution and production terms with the Complex). */
export const KFGQPC_LICENSE_STATUS =
  'UNVERIFIED: the Complex publishes the data for application and software development; redistribution and production terms are pending written clarification.';

const SURAH_BANNER_PREFIX = 'سُورَةُ ';

interface CsvRow {
  readonly id: number;
  readonly jozz: number;
  readonly page: number;
  readonly sura_no: number;
  readonly sura_name_ar: string;
  readonly line_start: number;
  readonly line_end: number;
  readonly aya_no: number;
  readonly aya_text_unicode: string;
}

export interface JuzEvidence {
  readonly juz: number;
  readonly start: { readonly surah: number; readonly ayah: number };
  readonly verification: 'MARKER_CONFIRMED' | 'SURAH_START_NO_MARKER' | 'MARKER_CONFLICT';
  readonly page: number;
  readonly line: number;
  /** For a MARKER_CONFLICT only: the nearest printed quarter marker before the `jozz` start and the nearest one after it (evidence for review, no ruling). */
  readonly nearestMarkerBefore: { readonly surah: number; readonly ayah: number } | null;
  readonly nearestMarkerAfter: { readonly surah: number; readonly ayah: number } | null;
}

export interface ConversionReport {
  readonly packageSha256: string;
  readonly packageVersion: string;
  readonly counts: { readonly surahs: number; readonly ayahs: number; readonly pages: number; readonly lines: number; readonly banners: number; readonly basmalas: number; readonly textLines: number; readonly quarters: number; readonly quarterMarks: number };
  readonly crossChecks: Readonly<Record<string, string>>;
  readonly juz: readonly JuzEvidence[];
}

export interface ConversionResult {
  /** The normalized dataset (format version 2), ready for `validateQuranDataset` and `npm run import:quran`. Deterministic. */
  readonly dataset: Record<string, unknown>;
  readonly report: ConversionReport;
}

class Problems {
  readonly list: string[] = [];
  total = 0;
  add(message: string): void {
    this.total += 1;
    if (this.list.length < MAX_REPORTED_PROBLEMS) this.list.push(message);
  }
}

const sha256 = (data: Buffer | string): string => createHash('sha256').update(data).digest('hex');

/** RFC 4180 CSV parser (quoted fields, doubled quotes, embedded newlines). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < body.length; i += 1) {
    const c = body[i]!;
    if (quoted) {
      if (c === '"') {
        if (body[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && body[i + 1] === '\n') i += 1;
      row.push(field);
      field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const words = (text: string): string[] => text.split(/\s+/).filter((w) => w.length > 0 && w !== RUB_EL_HIZB_MARK);

function readRows(jsonText: string, csvText: string, problems: Problems): CsvRow[] {
  const raw: unknown = JSON.parse(jsonText);
  if (!Array.isArray(raw) || raw.length !== QURAN_AYAH_COUNT) {
    problems.add(`The official JSON must hold ${QURAN_AYAH_COUNT} ayah rows (found ${Array.isArray(raw) ? raw.length : 'none'}).`);
    return [];
  }
  const rows = raw as CsvRow[];
  const csv = parseCsv(csvText);
  const header = csv[0] ?? [];
  const col = (name: string): number => header.indexOf(name);
  const fields: Array<keyof CsvRow> = ['id', 'jozz', 'page', 'sura_no', 'sura_name_ar', 'line_start', 'line_end', 'aya_no', 'aya_text_unicode'];
  for (const f of fields) if (col(f) < 0) problems.add(`The official CSV has no "${f}" column.`);
  if (csv.length - 1 !== rows.length) problems.add(`The official CSV has ${csv.length - 1} rows and the JSON ${rows.length}.`);
  rows.forEach((r, i) => {
    const c = csv[i + 1];
    for (const f of fields) {
      if (c && col(f) >= 0 && String(r[f]) !== c[col(f)]) {
        problems.add(`Row ${i + 1}: the JSON and the CSV disagree on "${f}".`);
        break;
      }
    }
  });
  return rows;
}

/**
 * Converts the approved official package into the normalized Module 21 dataset (format version 2), deterministically, using ONLY the package:
 *  - ayah text, surah names, page and line range of every ayah, the `jozz` juz of every ayah: the official CSV/JSON (the two are compared field by field);
 *  - the printed layout (banner lines, basmala lines, the 15-line pages, the line breaks): the official DOCX, rebuilt from its line and page breaks;
 *  - quarter starts: the printed quarter markers (U+06DE) in the official text. No other quarter or hizb boundary exists in the package.
 * Cross-checks (any failure aborts with every problem found): the package SHA-256; ZIP integrity; JSON == CSV; ayah numbering; the word stream of
 * the DOCX == the word stream of the CSV; the page and line range of every one of the 6236 ayahs in the CSV == its position in the DOCX;
 * 604 pages; one banner per surah matching its official name; a basmala line for every surah but 1 and 9; juz 1..30 contiguous.
 */
export function convertKfgqpcHafsPackage(zipBytes: Buffer, tanzilXmlBytes: Buffer, approved = APPROVED_KFGQPC_HAFS_PACKAGES, approvedQuarterFiles = APPROVED_TANZIL_QUARTER_FILES): ConversionResult {
  const problems = new Problems();
  const packageSha = sha256(zipBytes);
  const tanzilSha = sha256(tanzilXmlBytes);
  const knownQuarterFile = approvedQuarterFiles.find((f) => f.sha256 === tanzilSha);
  if (!knownQuarterFile) throw new QuranDatasetValidationError([`The quarter file SHA-256 ${tanzilSha} is not an approved quarter source file (approved: ${approvedQuarterFiles.map((f) => `${f.fileName} ${f.sha256}`).join('; ')}).`]);
  const known = approved.find((p) => p.sha256 === packageSha);
  if (!known) throw new QuranDatasetValidationError([`The package SHA-256 ${packageSha} is not an approved Hafs package (approved: ${approved.map((p) => `${p.fileName} ${p.sha256}`).join('; ')}).`]);

  const entries = readZip(zipBytes);
  const find = (suffix: string): Buffer => {
    const entry = entries.find((e) => e.name.endsWith(suffix));
    if (!entry) throw new QuranDatasetValidationError([`The package has no "${suffix}".`]);
    return entry.data;
  };
  const jsonBytes = find('kfgqpc_hafs_v30.json');
  const csvBytes = find('kfgqpc_hafs_v30.csv');
  const docxBytes = find('kfgqpc_hafs_v30.docx');
  const xlsxBytes = find('kfgqpc_hafs_v30.xlsx');
  const documentXml = readZip(docxBytes).find((e) => e.name === 'word/document.xml')?.data.toString('utf8');
  if (documentXml === undefined) throw new QuranDatasetValidationError(['The DOCX has no word/document.xml.']);

  const rows = readRows(jsonBytes.toString('utf8'), csvBytes.toString('utf8'), problems);
  if (rows.length === 0) throw new QuranDatasetValidationError(problems.list, problems.total);

  // ----- the official Excel: its values are the juz source and are compared with the CSV/JSON field by field (discrepancies are reported, never corrected) -----
  const sheet = readXlsxFirstSheet(xlsxBytes);
  const columns: Array<keyof CsvRow | 'sura_name_en' | 'aya_text_emlaey'> = ['id', 'jozz', 'page', 'sura_no', 'sura_name_en', 'sura_name_ar', 'line_start', 'line_end', 'aya_no', 'aya_text_unicode', 'aya_text_emlaey'];
  if (JSON.stringify(sheet[0]) !== JSON.stringify(columns)) problems.add(`The Excel header must be ${columns.join(', ')}.`);
  if (sheet.length - 1 !== rows.length) problems.add(`The Excel file has ${sheet.length - 1} rows and the JSON ${rows.length}.`);
  const excelJozz: number[] = [];
  let excelMismatches = 0;
  rows.forEach((r, i) => {
    const cells = sheet[i + 1] ?? [];
    excelJozz.push(Number(cells[1]));
    for (const [c, name] of columns.entries()) {
      if (cells[c] !== String((r as unknown as Record<string, unknown>)[name])) {
        if ((excelMismatches += 1) <= 10) problems.add(`Row ${i + 1}: the Excel "${name}" is "${cells[c] ?? ''}" and the CSV/JSON "${String((r as unknown as Record<string, unknown>)[name]).slice(0, 40)}" (reported, not corrected).`);
        break;
      }
    }
  });
  if (excelMismatches > 0) problems.add(`${excelMismatches} rows differ between the Excel and the CSV/JSON.`);

  // ----- the approved quarter source (all 240 records, exactly as stated) -----
  const tanzil = readTanzilQuarters(tanzilXmlBytes.toString('utf8'));
  if (problems.total > 0) throw new QuranDatasetValidationError(problems.list, problems.total);

  // ----- official ayah rows -----
  const surahNames = new Map<number, string>();
  rows.forEach((r, i) => {
    const position = ayahPositionOf(i + 1)!;
    if (r.id !== i + 1 || r.sura_no !== position.surah || r.aya_no !== position.ayah) problems.add(`Row ${i + 1} must be ${position.surah}:${position.ayah} with id ${i + 1} (found id ${r.id}, ${r.sura_no}:${r.aya_no}).`);
    if (!Number.isInteger(r.page) || r.page < 1 || r.page > QURAN_PAGE_COUNT || r.line_start < 1 || r.line_end < r.line_start) problems.add(`Row ${i + 1} (${position.surah}:${position.ayah}) has an invalid page/line range.`);
    if (typeof r.aya_text_unicode !== 'string' || r.aya_text_unicode.length === 0) problems.add(`Row ${i + 1} (${position.surah}:${position.ayah}) has no text.`);
    if (!surahNames.has(r.sura_no)) surahNames.set(r.sura_no, r.sura_name_ar);
    else if (surahNames.get(r.sura_no) !== r.sura_name_ar) problems.add(`Surah ${r.sura_no} has two different Arabic names in the official file.`);
    if (i > 0 && (r.jozz < rows[i - 1]!.jozz || r.jozz > rows[i - 1]!.jozz + 1)) problems.add(`Row ${i + 1}: the "jozz" field must not decrease or skip a juz.`);
  });
  if (rows[0]!.jozz !== 1 || rows[QURAN_AYAH_COUNT - 1]!.jozz !== QURAN_JUZ_COUNT) problems.add('The "jozz" field must run from 1 to 30.');
  if (surahNames.size !== QURAN_SURAH_COUNT) problems.add(`The official file names ${surahNames.size} surahs, not ${QURAN_SURAH_COUNT}.`);
  if (problems.total > 0) throw new QuranDatasetValidationError(problems.list, problems.total);

  // ----- official word stream (the quarter marker is a sign, not a word) -----
  const ayahOfWord: number[] = [];
  const csvWords: string[] = [];
  const firstWord: number[] = new Array<number>(QURAN_AYAH_COUNT + 1).fill(0);
  const lastWord: number[] = new Array<number>(QURAN_AYAH_COUNT + 1).fill(0);
  rows.forEach((r, i) => {
    const w = words(r.aya_text_unicode);
    firstWord[i + 1] = csvWords.length;
    for (const word of w) {
      csvWords.push(word);
      ayahOfWord.push(i + 1);
    }
    lastWord[i + 1] = csvWords.length - 1;
  });

  // ----- official DOCX layout -----
  const docxLines = readDocxLines(documentXml);
  const perParagraph = new Map<number, number>();
  for (const l of docxLines) perParagraph.set(l.paragraph, (perParagraph.get(l.paragraph) ?? 0) + 1);
  type Kind = 'SURAH_HEADER' | 'BASMALA' | 'TEXT';
  const kinds: Kind[] = [];
  let banners = 0;
  const basmalaSkeleton = skeleton(words(rows[0]!.aya_text_unicode).slice(0, -1).join(' '));
  const surahOfLine: number[] = [];
  let currentSurah = 0;
  for (const l of docxLines) {
    const single = perParagraph.get(l.paragraph) === 1;
    const expectedBanner = banners < QURAN_SURAH_COUNT ? SURAH_BANNER_PREFIX + surahNames.get(banners + 1)! : undefined;
    if (single && expectedBanner !== undefined && l.text === expectedBanner) {
      banners += 1;
      currentSurah = banners;
      kinds.push('SURAH_HEADER');
    } else if (single && !l.text.includes(AYAH_END_MARK) && skeleton(l.text) === basmalaSkeleton) kinds.push('BASMALA'); // a standalone basmala line is never an ayah (no end-of-ayah mark)
    else kinds.push('TEXT');
    surahOfLine.push(currentSurah);
  }
  const bannerCount = kinds.filter((k) => k === 'SURAH_HEADER').length;
  const basmalaCount = kinds.filter((k) => k === 'BASMALA').length;
  if (bannerCount !== QURAN_SURAH_COUNT) problems.add(`The DOCX layout has ${bannerCount} surah banner lines (${QURAN_SURAH_COUNT} expected, each equal to "${SURAH_BANNER_PREFIX.trim()} <official name>").`);
  if (basmalaCount !== QURAN_SURAH_COUNT - SURAHS_WITHOUT_BASMALA_LINE.length) problems.add(`The DOCX layout has ${basmalaCount} basmala lines (${QURAN_SURAH_COUNT - SURAHS_WITHOUT_BASMALA_LINE.length} expected).`);
  const lastPage = docxLines[docxLines.length - 1]?.page ?? 0;
  if (lastPage !== QURAN_PAGE_COUNT) problems.add(`The DOCX layout has ${lastPage} pages (${QURAN_PAGE_COUNT} expected).`);
  if (problems.total > 0) throw new QuranDatasetValidationError(problems.list, problems.total);

  // word stream of the DOCX text lines == word stream of the official CSV
  const docWords: Array<{ readonly page: number; readonly line: number }> = [];
  const lineWordRange: Array<{ first: number; last: number } | undefined> = [];
  let mismatch = 0;
  docxLines.forEach((l, i) => {
    if (kinds[i] !== 'TEXT') return lineWordRange.push(undefined);
    const w = words(l.text);
    const first = docWords.length;
    for (const word of w) {
      if (word !== csvWords[docWords.length] && (mismatch += 1) <= 5) problems.add(`Word ${docWords.length + 1}: the DOCX has "${word}" on page ${l.page} line ${l.line} where the official text has "${csvWords[docWords.length] ?? '(end)'}".`);
      docWords.push({ page: l.page, line: l.line });
    }
    return lineWordRange.push({ first, last: docWords.length - 1 });
  });
  if (docWords.length !== csvWords.length) problems.add(`The DOCX text has ${docWords.length} words and the official text ${csvWords.length}.`);
  if (problems.total > 0) throw new QuranDatasetValidationError(problems.list, problems.total);

  // page and line range of every ayah: CSV == DOCX
  let disagreeing = 0;
  rows.forEach((r, i) => {
    const a = docWords[firstWord[i + 1]!]!;
    const b = docWords[lastWord[i + 1]!]!;
    if (a.page !== b.page || r.page !== a.page || r.line_start !== a.line || r.line_end !== b.line) {
      if ((disagreeing += 1) <= 10) problems.add(`Ayah ${r.sura_no}:${r.aya_no}: the CSV says page ${r.page} lines ${r.line_start}-${r.line_end}; the DOCX layout says page ${a.page} line ${a.line} to page ${b.page} line ${b.line}.`);
    }
  });
  if (disagreeing > 0) problems.add(`${disagreeing} ayahs disagree between the CSV and the DOCX layout.`);
  if (problems.total > 0) throw new QuranDatasetValidationError(problems.list, problems.total);

  // ----- normalized dataset -----
  const ref = (global: number) => {
    const p = ayahPositionOf(global)!;
    return { surah: p.surah, ayah: p.ayah };
  };
  const lines = docxLines.map((l: DocxLine, i) => {
    if (kinds[i] === 'SURAH_HEADER') return { page: l.page, line: l.line, kind: 'SURAH_HEADER', surah: surahOfLine[i]! };
    if (kinds[i] === 'BASMALA') return { page: l.page, line: l.line, kind: 'BASMALA', surah: surahOfLine[i]! };
    const range = lineWordRange[i]!;
    return { page: l.page, line: l.line, kind: 'TEXT', firstAyah: ref(ayahOfWord[range.first]!), lastAyah: ref(ayahOfWord[range.last]!) };
  });
  const juz = Array.from({ length: QURAN_JUZ_COUNT }, (_, k) => {
    const first = excelJozz.findIndex((j) => j === k + 1) + 1; // the Excel's own value: the first ayah whose jozz is this juz
    return { juz: k + 1, start: ref(first) };
  });
  const quarters = tanzil.quarters.map((q) => ({ quarter: q.index, start: { surah: q.surah, ayah: q.ayah } }));
  const marked = rows.map((r) => r.aya_text_unicode.startsWith(`${RUB_EL_HIZB_MARK} `));
  const quarterMarks = marked.flatMap((m, i) => (m ? [{ start: ref(i + 1) }] : []));

  const files = [
    { name: known.fileName, sha256: packageSha },
    { name: 'kfgqpc_hafs_v30.json', sha256: sha256(jsonBytes) },
    { name: 'kfgqpc_hafs_v30.csv', sha256: sha256(csvBytes) },
    { name: 'kfgqpc_hafs_v30.xlsx', sha256: sha256(xlsxBytes) },
    { name: 'kfgqpc_hafs_v30.docx', sha256: sha256(docxBytes) },
    { name: knownQuarterFile.fileName, sha256: tanzilSha },
  ];
  const dataset: Record<string, unknown> = {
    format: 'qsms-quran-structure',
    formatVersion: 3,
    edition: { mushaf: 'MADINAH_MUSHAF', narration: 'HAFS_AN_ASIM', pages: QURAN_PAGE_COUNT },
    source: {
      provider: 'King Fahd Glorious Quran Printing Complex',
      name: 'Hafs v30 developer package (Unicode Uthmanic data, DOCX layout)',
      version: known.version,
      url: KFGQPC_SOURCE_URL,
      license: KFGQPC_LICENSE_STATUS,
      files,
      attributions: [
        { role: 'Quran text, page and line layout, juz (Excel jozz)', provider: 'King Fahd Glorious Quran Printing Complex', name: 'Hafs v30 developer package', version: known.version, license: KFGQPC_LICENSE_STATUS, notice: KFGQPC_SOURCE_URL },
        { role: 'Quarters (rub\' al-hizb): all 240 records', provider: 'Tanzil Project (tanzil.net)', name: knownQuarterFile.fileName, version: tanzil.meta.version, license: tanzil.meta.license, notice: tanzil.meta.copyright },
      ],
    },
    surahs: SURAH_AYAH_COUNTS.map((ayahCount, i) => ({ number: i + 1, nameAr: surahNames.get(i + 1)!, ayahCount })),
    ayahs: rows.map((r) => ({ surah: r.sura_no, ayah: r.aya_no, text: r.aya_text_unicode })),
    lines,
    juz,
    quarters,
    quarterMarks,
  };

  // ----- evidence report for the juz starts (for review; the validator derives the same statuses) -----
  const startsGlobal = juz.map((j) => globalPositionOf(j.start.surah, j.start.ayah)!);
  const juzEvidence: JuzEvidence[] = juz.map((j, k) => {
    const g = startsGlobal[k]!;
    const verification = marked[g - 1] ? 'MARKER_CONFIRMED' : j.start.ayah === 1 ? 'SURAH_START_NO_MARKER' : 'MARKER_CONFLICT';
    const markGlobals = quarterMarks.map((m) => globalPositionOf(m.start.surah, m.start.ayah)!);
    const before = [...markGlobals].reverse().find((m) => m < g);
    const after = markGlobals.find((m) => m > g);
    const at = docWords[firstWord[g]!]!;
    const conflict = verification === 'MARKER_CONFLICT';
    return { juz: j.juz, start: j.start, verification, page: at.page, line: at.line, nearestMarkerBefore: conflict && before ? ref(before) : null, nearestMarkerAfter: conflict && after ? ref(after) : null };
  });
  const report: ConversionReport = {
    packageSha256: packageSha,
    packageVersion: known.version,
    counts: { surahs: QURAN_SURAH_COUNT, ayahs: rows.length, pages: lastPage, lines: docxLines.length, banners: bannerCount, basmalas: basmalaCount, textLines: kinds.filter((k) => k === 'TEXT').length, quarters: quarters.length, quarterMarks: quarterMarks.length },
    crossChecks: {
      'ZIP integrity (size and CRC-32 of every entry used)': 'passed',
      'package SHA-256 equals the published value': 'passed',
      'JSON == CSV (9 fields, 6236 rows)': 'passed',
      'Excel == CSV/JSON (all 11 columns, every row); juz taken from the Excel jozz values': `passed (${excelJozz.length} rows)`,
      'quarter file: indexes 1..N in order, valid ayahs, strictly increasing; records imported as stated': `passed (${quarters.length} records)`,
      'ayah numbering 1..6236 in canonical order': 'passed',
      'DOCX word stream == official text word stream': `passed (${csvWords.length} words)`,
      'CSV page and line range == DOCX position, every ayah': 'passed (6236 of 6236)',
      'one banner per surah equal to its official name; basmala lines for all but surahs 1 and 9': `passed (${bannerCount} banners, ${basmalaCount} basmalas)`,
      'jozz: 1..30, contiguous, never decreasing': 'passed',
    },
    juz: juzEvidence,
  };
  return { dataset, report };
}

const skeleton = (text: string): string => text.replace(/[^\p{L} ]/gu, '').replace(/\s+/g, ' ').trim();

/** Canonical, byte-stable serialization of the converted dataset (same package => identical bytes). */
export const serializeDataset = (dataset: Record<string, unknown>): string => `${JSON.stringify(dataset)}\n`;
