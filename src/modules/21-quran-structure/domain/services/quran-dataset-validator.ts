import { isIsoDate } from '../../../00-shared-kernel/public';
import type { Ayah, QuranJuz, QuranLine, QuranPage, QuranQuarter, QuranQuarterMark, QuranSourceInfo, Surah, ValidatedQuranDataset } from '../entities/quran-structure';
import { QuranDatasetValidationError } from '../errors/quran-errors';
import {
  AYAH_END_MARK,
  LINE_KINDS,
  MADINAH_HAFS_604_PROFILE,
  QURAN_AYAH_COUNT,
  QURAN_JUZ_COUNT,
  QURAN_QUARTER_COUNT,
  QURAN_SURAH_COUNT,
  RUB_EL_HIZB_MARK,
  SURAHS_WITHOUT_BASMALA_LINE,
  SURAH_AYAH_COUNTS,
  ayahPositionOf,
  firstGlobalAyahOf,
  hizbOfQuarter,
  isLineKind,
  type EditionProfile,
  type JuzVerification,
  type LineKind,
} from '../value-objects/quran-edition';

/**
 * The dataset file format accepted by the importer (format version 3, documented in docs/QURAN-STRUCTURE.md):
 * {
 *   "format": "qsms-quran-structure", "formatVersion": 2,
 *   "edition": { "mushaf": "MADINAH_MUSHAF", "narration": "HAFS_AN_ASIM", "pages": 604 },
 *   "source": { "provider", "name", "version"?, "url"?, "license"?, "retrievedOn"?, "files"?: [ { "name", "sha256" } ],
 *               "attributions"?: [ { "role", "provider", "name", "version"?, "license"?, "notice"? } ] },
 *   "surahs":      [ { "number": 1, "nameAr": "...", "ayahCount": 7 }, ... 114 ],
 *   "ayahs":       [ { "surah": 1, "ayah": 1, "text": "..." }, ... 6236 ]     (the official text, verbatim: REQUIRED)
 *   "lines":       [ { "page": 1, "line": 1, "kind": "SURAH_HEADER", "surah": 1 },
 *                    { "page": 1, "line": 2, "kind": "TEXT", "firstAyah": { "surah": 1, "ayah": 1 }, "lastAyah": { "surah": 1, "ayah": 1 } }, ... ],
 *   "juz":         [ { "juz": 1, "start": { "surah": 1, "ayah": 1 } }, ... 30 ]       (the official KFGQPC Excel `jozz` values)
 *   "quarters":    [ { "quarter": 1, "start": { "surah": 1, "ayah": 1 } }, ... 240 ]   (the approved quarter source, all 240 records)
 *   "quarterMarks":[ { "start": { "surah": 2, "ayah": 26 } }, ... ]                   (every ayah whose official text starts with the printed quarter marker)
 * }
 * Everything else (global positions, per-ayah first/last page and line and juz, per-page ranges, the evidence status of every juz start) is
 * DERIVED here from that data and cross-checked; nothing is guessed, approximated or filled in. The juz and the quarters come from different
 * approved sources and are NOT reconciled with each other. A dataset that is incomplete, inconsistent or not the approved edition is rejected as a whole with EVERY problem found (the first 50 are listed). This function is pure.
 */
export const DATASET_FORMAT = 'qsms-quran-structure';
export const DATASET_FORMAT_VERSION = 3;
export const MAX_REPORTED_PROBLEMS = 50;

const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F]/;
type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const isInt = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value);

class Problems {
  readonly list: string[] = [];
  total = 0;
  add(message: string): void {
    this.total += 1;
    if (this.list.length < MAX_REPORTED_PROBLEMS) this.list.push(message);
  }
}

function text(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= max && !CONTROL_CHARACTERS.test(trimmed) ? trimmed : undefined;
}

function optionalText(parent: Json, key: string, max: number, where: string, problems: Problems): string | null {
  const value = parent[key];
  if (value === undefined || value === null) return null;
  const parsed = text(value, max);
  if (parsed === undefined) problems.add(`${where}.${key} must be a non-empty text of at most ${max} characters (or absent).`);
  return parsed ?? null;
}

function readSource(root: Json, problems: Problems): QuranSourceInfo {
  const source = root.source;
  if (!isObject(source)) {
    problems.add('"source" (attribution of the dataset: provider and name) is required.');
    return { provider: '', name: '', version: null, url: null, license: null, retrievedOn: null, files: [], attributions: [] };
  }
  const provider = text(source.provider, 200);
  const name = text(source.name, 200);
  if (provider === undefined) problems.add('source.provider is required (a non-empty text of at most 200 characters).');
  if (name === undefined) problems.add('source.name is required (a non-empty text of at most 200 characters).');
  let retrievedOn: string | null = null;
  if (source.retrievedOn !== undefined && source.retrievedOn !== null) {
    if (typeof source.retrievedOn === 'string' && isIsoDate(source.retrievedOn)) retrievedOn = source.retrievedOn;
    else problems.add('source.retrievedOn must be an ISO date (YYYY-MM-DD) or absent.');
  }
  const attributions: Array<{ role: string; provider: string; name: string; version: string | null; license: string | null; notice: string | null }> = [];
  if (source.attributions !== undefined) {
    if (!Array.isArray(source.attributions) || source.attributions.length > 10) problems.add('source.attributions must be a list of at most 10 entries (or absent).');
    else
      source.attributions.forEach((entry: unknown, index) => {
        if (!isObject(entry)) {
          problems.add(`source.attributions[${index}] must be an object.`);
          return;
        }
        const role = text(entry.role, 100);
        const provider = text(entry.provider, 200);
        const name = text(entry.name, 200);
        if (role === undefined || provider === undefined || name === undefined) problems.add(`source.attributions[${index}] needs a "role", a "provider" and a "name".`);
        else attributions.push({ role, provider, name, version: optionalText(entry, 'version', 100, `source.attributions[${index}]`, problems), license: optionalText(entry, 'license', 500, `source.attributions[${index}]`, problems), notice: optionalText(entry, 'notice', 500, `source.attributions[${index}]`, problems) });
      });
  }
  const files: Array<{ name: string; sha256: string }> = [];
  if (source.files !== undefined) {
    if (!Array.isArray(source.files) || source.files.length > 20) problems.add('source.files must be a list of at most 20 { "name", "sha256" } entries (or absent).');
    else
      source.files.forEach((entry: unknown, index) => {
        const fileName = isObject(entry) ? text(entry.name, 200) : undefined;
        const sha = isObject(entry) && typeof entry.sha256 === 'string' && /^[0-9a-f]{64}$/.test(entry.sha256) ? entry.sha256 : undefined;
        if (fileName === undefined || sha === undefined) problems.add(`source.files[${index}] needs a "name" and a lowercase hexadecimal 64-character "sha256".`);
        else files.push({ name: fileName, sha256: sha });
      });
  }
  return {
    provider: provider ?? '',
    name: name ?? '',
    version: optionalText(source, 'version', 100, 'source', problems),
    url: optionalText(source, 'url', 500, 'source', problems),
    license: optionalText(source, 'license', 500, 'source', problems),
    retrievedOn,
    files,
    attributions,
  };
}

const surahOfGlobal = (g: number): number => ayahPositionOf(g)!.surah;
const globalOf = (surah: number, ayah: number): number => firstGlobalAyahOf(surah) + ayah - 1;
const ayahNumberOf = (global: number): number => ayahPositionOf(global)!.ayah;

/** An ayah reference {surah, ayah} -> its global position; undefined (and a problem) when it is not a real ayah of the Hafs count. */
function readRef(value: unknown, where: string, problems: Problems): number | undefined {
  if (!isObject(value) || !isInt(value.surah) || !isInt(value.ayah)) {
    problems.add(`${where} must be { "surah": <1-114>, "ayah": <number> }.`);
    return undefined;
  }
  if (value.surah < 1 || value.surah > QURAN_SURAH_COUNT || value.ayah < 1 || value.ayah > SURAH_AYAH_COUNTS[value.surah - 1]!) {
    problems.add(`${where} (${value.surah}:${value.ayah}) is not an ayah of the Hafs count.`);
    return undefined;
  }
  return globalOf(value.surah, value.ayah);
}

interface RawLine {
  readonly page: number;
  readonly line: number;
  readonly kind: LineKind;
  readonly surah: number | null;
  readonly first: number | null;
  readonly last: number | null;
}

function readSurahs(root: Json, problems: Problems): Surah[] {
  const raw = root.surahs;
  if (!Array.isArray(raw) || raw.length !== QURAN_SURAH_COUNT) {
    problems.add(`"surahs" must list exactly ${QURAN_SURAH_COUNT} surahs (found ${Array.isArray(raw) ? raw.length : 'none'}).`);
    return [];
  }
  const surahs: Surah[] = [];
  raw.forEach((entry: unknown, index) => {
    const where = `surahs[${index}]`;
    const expected = index + 1;
    if (!isObject(entry)) {
      problems.add(`${where} must be an object.`);
      return;
    }
    if (entry.number !== expected) problems.add(`${where}.number must be ${expected} (surahs are listed in order, once each).`);
    const nameAr = text(entry.nameAr, 100);
    if (nameAr === undefined) problems.add(`${where}.nameAr is required (a non-empty text of at most 100 characters).`);
    if (entry.ayahCount !== SURAH_AYAH_COUNTS[index]) problems.add(`${where}.ayahCount must be ${SURAH_AYAH_COUNTS[index]} for surah ${expected} in the Hafs count (found ${String(entry.ayahCount)}).`);
    surahs.push({ number: expected, nameAr: nameAr ?? '', ayahCount: SURAH_AYAH_COUNTS[index]!, firstGlobalAyah: firstGlobalAyahOf(expected) });
  });
  return surahs;
}

const ARABIC_INDIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const arabicIndic = (n: number): string => String(n).replace(/\d/g, (d) => ARABIC_INDIC_DIGITS[Number(d)]!);

/** The official ayah texts (all 6236, canonical order, verbatim). Returns the text by global position. */
function readAyahs(root: Json, problems: Problems): string[] {
  const raw = root.ayahs;
  const texts: string[] = new Array<string>(QURAN_AYAH_COUNT + 1).fill('');
  if (!Array.isArray(raw) || raw.length !== QURAN_AYAH_COUNT) {
    problems.add(`"ayahs" (the official text) is required and must list all ${QURAN_AYAH_COUNT} ayahs (found ${Array.isArray(raw) ? raw.length : 'none'}).`);
    return texts;
  }
  raw.forEach((entry: unknown, index) => {
    const global = index + 1;
    const where = `ayahs[${index}]`;
    if (!isObject(entry)) {
      problems.add(`${where} must be an object.`);
      return;
    }
    const position = ayahPositionOf(global)!;
    if (entry.surah !== position.surah || entry.ayah !== position.ayah) problems.add(`${where} must be ${position.surah}:${position.ayah} (canonical order, none missing or repeated).`);
    const value = typeof entry.text === 'string' ? entry.text : undefined;
    if (value === undefined || value.trim() !== value || value.length === 0 || value.length > 4000 || CONTROL_CHARACTERS.test(value)) {
      problems.add(`${where}.text must be the official text: non-empty, trimmed, at most 4000 characters, without control characters.`);
      return;
    }
    // integrity: the official text ends with the end-of-ayah mark and the ayah number in Arabic-Indic digits
    if (!value.endsWith(`${AYAH_END_MARK}${arabicIndic(position.ayah)}`)) problems.add(`${where}.text must end with the end-of-ayah mark and the ayah number ${arabicIndic(position.ayah)}.`);
    // the quarter marker, when present, is only ever the first character (followed by a space)
    const markAt = value.indexOf(RUB_EL_HIZB_MARK);
    if (markAt > 0 || (markAt === 0 && value[1] !== ' ')) problems.add(`${where}.text carries the quarter marker somewhere other than its beginning.`);
    if (value.split(RUB_EL_HIZB_MARK).length > 2) problems.add(`${where}.text carries more than one quarter marker.`);
    texts[global] = value;
  });
  return texts;
}

function readLines(root: Json, profile: EditionProfile, problems: Problems): RawLine[] {
  const raw = root.lines;
  if (!Array.isArray(raw) || raw.length === 0) {
    problems.add('"lines" (the page and line layout) is required and must not be empty.');
    return [];
  }
  const lines: RawLine[] = [];
  let expectedPage = 1;
  let expectedLine = 1;
  raw.forEach((entry: unknown, index) => {
    const where = `lines[${index}]`;
    if (!isObject(entry)) {
      problems.add(`${where} must be an object.`);
      return;
    }
    const { page, line, kind } = entry;
    if (!isInt(page) || !isInt(line) || !isLineKind(kind)) {
      {
      problems.add(`${where} needs an integer "page", an integer "line" and a "kind" of ${LINE_KINDS.join(' / ')}.`);
      return;
    }
    }
    if (page === expectedPage + 1 && line === 1) {
      expectedPage = page;
      expectedLine = 1;
    }
    if (page !== expectedPage || line !== expectedLine) problems.add(`${where} is page ${page} line ${line} but page ${expectedPage} line ${expectedLine} was expected (pages 1..${profile.pageCount} in order, lines 1..n without gaps, none repeated).`);
    expectedPage = page;
    expectedLine = line + 1;
    let surah: number | null = null;
    let first: number | null = null;
    let last: number | null = null;
    if (kind === 'TEXT') {
      first = readRef(entry.firstAyah, `${where}.firstAyah`, problems) ?? null;
      last = readRef(entry.lastAyah, `${where}.lastAyah`, problems) ?? null;
      if (first !== null && last !== null && first > last) problems.add(`${where}: firstAyah comes after lastAyah.`);
      if (entry.surah !== undefined && entry.surah !== null) problems.add(`${where}: a TEXT line carries ayahs, not a "surah".`);
    } else {
      if (!isInt(entry.surah) || entry.surah < 1 || entry.surah > QURAN_SURAH_COUNT) problems.add(`${where} (${kind}) needs "surah" 1-114.`);
      else surah = entry.surah;
      if (entry.firstAyah !== undefined || entry.lastAyah !== undefined) problems.add(`${where}: a ${kind} line carries no ayahs.`);
    }
    lines.push({ page, line, kind, surah, first, last });
  });
  if (expectedPage !== profile.pageCount) problems.add(`The layout must cover exactly ${profile.pageCount} pages (it ends at page ${expectedPage}).`);
  return lines;
}

/** The reading-order rules of the Madinah layout: continuity of ayahs line to line, one banner per surah, no surah boundary inside a line. */
function checkLayout(lines: readonly RawLine[], pageCount: number, problems: Problems): void {
  const pagesWithText = new Set<number>();
  let prevLast: number | undefined;
  let pending: number | null = null;
  let basmalaSeen = false;
  let nextHeader = 1;
  for (const l of lines) {
    const where = `page ${l.page} line ${l.line}`;
    if (l.kind === 'SURAH_HEADER') {
      if (l.surah === null) continue;
      if (l.surah !== nextHeader) problems.add(`${where}: the banner of surah ${l.surah} appears where the banner of surah ${nextHeader} was expected (one banner per surah, in order).`);
      if (pending !== null) problems.add(`${where}: the banner of surah ${pending} is not followed by its first ayah.`);
      pending = l.surah;
      basmalaSeen = false;
      nextHeader = l.surah + 1;
    } else if (l.kind === 'BASMALA') {
      if (l.surah === null) continue;
      if (SURAHS_WITHOUT_BASMALA_LINE.includes(l.surah)) problems.add(`${where}: surah ${l.surah} has no separate basmala line.`);
      if (pending !== l.surah || basmalaSeen) problems.add(`${where}: a basmala line must directly follow the banner of its own surah, once.`);
      basmalaSeen = true;
    } else {
      if (l.first === null || l.last === null) continue;
      const startsNewAyah = prevLast === undefined || l.first === prevLast + 1;
      if (surahOfGlobal(l.first) !== surahOfGlobal(l.last)) problems.add(`${where}: a text line cannot cross a surah boundary.`);
      if (prevLast === undefined ? l.first !== 1 : l.first !== prevLast && l.first !== prevLast + 1) {
        problems.add(`${where}: the ayah order breaks (the line starts at global ayah ${l.first}, the previous text line ended at ${prevLast ?? 'nothing'}).`);
      }
      if (pending !== null) {
        if (l.first !== firstGlobalAyahOf(pending) || !startsNewAyah) problems.add(`${where}: after the banner of surah ${pending} the line must start with ${pending}:1.`);
        pending = null;
      } else if (startsNewAyah && ayahNumberOf(l.first) === 1) {
        problems.add(`${where}: surah ${surahOfGlobal(l.first)} starts here without its banner line.`);
      }
      prevLast = l.last;
      pagesWithText.add(l.page);
    }
  }
  for (let page = 1; page <= pageCount; page += 1) if (!pagesWithText.has(page)) problems.add(`Page ${page} has no text line.`);
  if (pending !== null) problems.add(`The banner of surah ${pending} is not followed by its first ayah.`);
  if (nextHeader !== QURAN_SURAH_COUNT + 1) problems.add(`Every surah needs exactly one banner line (${nextHeader - 1} found, ${QURAN_SURAH_COUNT} expected).`);
  if (prevLast !== QURAN_AYAH_COUNT) problems.add(`The layout must end with the last ayah (global ${QURAN_AYAH_COUNT}), it ends at ${prevLast ?? 'nothing'}.`);
}

/** The 240 quarter records of the approved quarter source: in order, strictly increasing, each a valid ayah, the first at 1:1. */
function readQuarters(root: Json, problems: Problems): QuranQuarter[] {
  const raw = root.quarters;
  if (!Array.isArray(raw) || raw.length !== QURAN_QUARTER_COUNT) {
    problems.add(`"quarters" must list exactly ${QURAN_QUARTER_COUNT} quarter records (found ${Array.isArray(raw) ? raw.length : 'none'}).`);
    return [];
  }
  const quarters: QuranQuarter[] = [];
  let previous = 0;
  raw.forEach((entry: unknown, index) => {
    const where = `quarters[${index}]`;
    const quarter = index + 1;
    if (!isObject(entry)) {
      problems.add(`${where} must be an object.`);
      return;
    }
    if (entry.quarter !== quarter) problems.add(`${where}.quarter must be ${quarter} (in order, none missing, none repeated).`);
    const start = readRef(entry.start, `${where}.start`, problems);
    if (start === undefined) return;
    if (start <= previous) problems.add(`${where}.start (${surahOfGlobal(start)}:${ayahNumberOf(start)}) must come after the start of the previous quarter.`);
    previous = start;
    quarters.push({ quarter, hizb: hizbOfQuarter(quarter), startGlobalAyah: start, startSurah: surahOfGlobal(start), startAyah: ayahNumberOf(start) });
  });
  if (quarters.length === QURAN_QUARTER_COUNT && quarters[0]!.startGlobalAyah !== 1) problems.add('Quarter 1 must start at 1:1.');
  return quarters;
}

/** The printed quarter markers: exactly the ayahs whose official text starts with the marker (the evidence), strictly increasing. */
function readQuarterMarks(root: Json, texts: readonly string[], problems: Problems): QuranQuarterMark[] {
  const raw = root.quarterMarks;
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > QURAN_QUARTER_COUNT) {
    problems.add(`"quarterMarks" must list the printed quarter markers (1 to ${QURAN_QUARTER_COUNT}; found ${Array.isArray(raw) ? raw.length : 'none'}).`);
    return [];
  }
  const marks: QuranQuarterMark[] = [];
  let previous = 0;
  raw.forEach((entry: unknown, index) => {
    const where = `quarterMarks[${index}]`;
    if (!isObject(entry)) {
      problems.add(`${where} must be an object.`);
      return;
    }
    const start = readRef(entry.start, `${where}.start`, problems);
    if (start === undefined) return;
    if (start <= previous) problems.add(`${where}.start must come after the previous marker.`);
    previous = start;
    marks.push({ mark: index + 1, startGlobalAyah: start, startSurah: surahOfGlobal(start), startAyah: ayahNumberOf(start) });
  });
  const listed = new Set(marks.map((m) => m.startGlobalAyah));
  for (let g = 1; g <= QURAN_AYAH_COUNT; g += 1) {
    const marked = texts[g]!.startsWith(RUB_EL_HIZB_MARK);
    if (marked && !listed.has(g)) problems.add(`Ayah ${surahOfGlobal(g)}:${ayahNumberOf(g)} starts with the printed quarter marker but is not in "quarterMarks".`);
    if (!marked && listed.has(g)) problems.add(`"quarterMarks" lists ${surahOfGlobal(g)}:${ayahNumberOf(g)}, whose official text carries no quarter marker.`);
  }
  return marks;
}

/** The 30 juz starts (the official `jozz` boundaries) with how each relates to the printed markers. */
function readJuz(root: Json, texts: readonly string[], problems: Problems): QuranJuz[] {
  const raw = root.juz;
  if (!Array.isArray(raw) || raw.length !== QURAN_JUZ_COUNT) {
    problems.add(`"juz" must list exactly ${QURAN_JUZ_COUNT} juz starts (found ${Array.isArray(raw) ? raw.length : 'none'}).`);
    return [];
  }
  const juzs: QuranJuz[] = [];
  let previous = 0;
  raw.forEach((entry: unknown, index) => {
    const where = `juz[${index}]`;
    const juz = index + 1;
    if (!isObject(entry)) {
      problems.add(`${where} must be an object.`);
      return;
    }
    if (entry.juz !== juz) problems.add(`${where}.juz must be ${juz} (in order, once each).`);
    const start = readRef(entry.start, `${where}.start`, problems);
    if (start === undefined) return;
    if (start <= previous) problems.add(`${where}.start must come after the start of the previous juz.`);
    previous = start;
    const ayahNumber = ayahNumberOf(start);
    const verification: JuzVerification = texts[start]!.startsWith(RUB_EL_HIZB_MARK) ? 'MARKER_CONFIRMED' : ayahNumber === 1 ? 'SURAH_START_NO_MARKER' : 'MARKER_CONFLICT';
    juzs.push({ juz, verification, startGlobalAyah: start, startSurah: surahOfGlobal(start), startAyah: ayahNumber });
  });
  if (juzs.length === QURAN_JUZ_COUNT && juzs[0]!.startGlobalAyah !== 1) problems.add('Juz 1 must start at 1:1.');
  return juzs;
}

export function validateQuranDataset(input: unknown, profile: EditionProfile = MADINAH_HAFS_604_PROFILE): ValidatedQuranDataset {
  const problems = new Problems();
  if (!isObject(input)) throw new QuranDatasetValidationError(['The dataset must be a JSON object.']);
  const root = input;

  if (root.format !== DATASET_FORMAT) problems.add(`"format" must be "${DATASET_FORMAT}".`);
  if (root.formatVersion !== DATASET_FORMAT_VERSION) problems.add(`"formatVersion" must be ${DATASET_FORMAT_VERSION}.`);
  const edition = root.edition;
  if (!isObject(edition) || edition.mushaf !== profile.mushaf || edition.narration !== profile.narration || edition.pages !== profile.pageCount) {
    problems.add(`"edition" must be { "mushaf": "${profile.mushaf}", "narration": "${profile.narration}", "pages": ${profile.pageCount} }: only the approved edition is accepted.`);
  }
  const source = readSource(root, problems);
  const surahs = readSurahs(root, problems);
  const texts = readAyahs(root, problems);
  const rawLines = readLines(root, profile, problems);
  checkLayout(rawLines, profile.pageCount, problems);
  const juzs = readJuz(root, texts, problems);
  const quarters = readQuarters(root, problems);
  const quarterMarks = readQuarterMarks(root, texts, problems);

  // Derived per-ayah facts (only meaningful when the layout was readable; the problems above already reject the dataset otherwise).
  const firstPage = new Uint16Array(QURAN_AYAH_COUNT + 1);
  const firstLine = new Uint16Array(QURAN_AYAH_COUNT + 1);
  const lastPage = new Uint16Array(QURAN_AYAH_COUNT + 1);
  const lastLine = new Uint16Array(QURAN_AYAH_COUNT + 1);
  for (const l of rawLines) {
    if (l.kind !== 'TEXT' || l.first === null || l.last === null || l.first > l.last) continue;
    for (let g = l.first; g <= l.last; g += 1) {
      if (firstPage[g] === 0) {
        firstPage[g] = l.page;
        firstLine[g] = l.line;
      }
      lastPage[g] = l.page;
      lastLine[g] = l.line;
    }
  }
  if (problems.total === 0) {
    for (let g = 1; g <= QURAN_AYAH_COUNT; g += 1) if (firstPage[g] === 0) problems.add(`Global ayah ${g} (${surahOfGlobal(g)}:${ayahNumberOf(g)}) is on no line.`);
  }
  for (const a of profile.anchors.ayahFirstPage) {
    const g = globalOf(a.surah, a.ayah);
    if (problems.total === 0 && firstPage[g] !== a.page) problems.add(`Anchor: ayah ${a.surah}:${a.ayah} starts on page ${a.page} in the ${profile.code} edition but the dataset puts it on page ${firstPage[g]}.`);
  }
  if (problems.total > 0) throw new QuranDatasetValidationError(problems.list, problems.total);

  // ----- assemble (everything below is derived from validated input) -----
  // juz of every ayah: from the juz starts (the official `jozz` boundaries)
  const juzOf = new Uint8Array(QURAN_AYAH_COUNT + 1);
  let j = 0;
  for (let g = 1; g <= QURAN_AYAH_COUNT; g += 1) {
    while (j < QURAN_JUZ_COUNT && juzs[j]!.startGlobalAyah <= g) j += 1;
    juzOf[g] = j;
  }
  const quarterOf = new Uint16Array(QURAN_AYAH_COUNT + 1);
  let qi = 0;
  for (let g = 1; g <= QURAN_AYAH_COUNT; g += 1) {
    while (qi < QURAN_QUARTER_COUNT && quarters[qi]!.startGlobalAyah <= g) qi += 1;
    quarterOf[g] = qi;
  }
  const ayahs: Ayah[] = [];
  for (let g = 1; g <= QURAN_AYAH_COUNT; g += 1) {
    ayahs.push({ globalAyah: g, surah: surahOfGlobal(g), ayah: ayahNumberOf(g), text: texts[g]!, firstPage: firstPage[g]!, firstLine: firstLine[g]!, lastPage: lastPage[g]!, lastLine: lastLine[g]!, juz: juzOf[g]!, quarter: quarterOf[g]!, startsRubMarker: texts[g]!.startsWith(RUB_EL_HIZB_MARK) });
  }
  const lines: QuranLine[] = rawLines.map((l, index) => ({ globalLine: index + 1, page: l.page, line: l.line, kind: l.kind, surah: l.surah, firstGlobalAyah: l.first, lastGlobalAyah: l.last }));
  const pages: QuranPage[] = [];
  for (let page = 1; page <= profile.pageCount; page += 1) {
    const onPage = lines.filter((l) => l.page === page);
    const text = onPage.filter((l) => l.kind === 'TEXT');
    pages.push({ page, lineCount: onPage.length, firstGlobalAyah: text[0]!.firstGlobalAyah!, lastGlobalAyah: text[text.length - 1]!.lastGlobalAyah! });
  }
  return { editionCode: profile.code, source, surahs, ayahs, pages, lines, juzs, quarters, quarterMarks };
}
