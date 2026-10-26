import { deflateRawSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { crc32 } from '../../src/modules/21-quran-structure/infrastructure/source/zip-reader';
import { MADINAH_HAFS_604_PROFILE, QURAN_AYAH_COUNT, QURAN_JUZ_COUNT, QURAN_PAGE_COUNT, QURAN_QUARTER_COUNT, SURAHS_WITHOUT_BASMALA_LINE, SURAH_AYAH_COUNTS, ayahPositionOf, type EditionProfile } from '../../src/modules/21-quran-structure/public';

/**
 * A SYNTHETIC dataset with the exact SHAPE of the approved edition (114 surahs with the real Hafs ayah counts, 604 pages, a banner line per surah,
 * a basmala line except for surahs 1 and 9, ayahs that span lines and lines that hold two ayahs, 30 juz starts, printed quarter markers). It is NOT
 * Quran data: names and texts are placeholders, the line layout is arbitrary, juz starts and markers are evenly spread. It exists only to test the
 * validator, the importer, the converter and the API, and the REAL edition profile rejects it (its anchors do not match). Never import it.
 */
export const SYNTHETIC_PROFILE: EditionProfile = Object.freeze({ ...MADINAH_HAFS_604_PROFILE, code: 'SYNTHETIC_TEST_EDITION', anchors: Object.freeze({ ayahFirstPage: [] }) });

type Json = Record<string, unknown>;
const ref = (surah: number, ayah: number) => ({ surah, ayah });
const INDIC = '٠١٢٣٤٥٦٧٨٩';
const indic = (n: number) => String(n).replace(/\d/g, (d) => INDIC[Number(d)]!);
export const SYNTHETIC_BASMALA = 'بِسۡمِ ٱللَّهِ ٱلرَّحۡمَٰنِ ٱلرَّحِيمِ';

export const syntheticSurahName = (n: number) => `سورة${'ا'.repeat(1 + (n % 5))}`;
/** Quarter q starts at this global ayah (evenly spread, strictly increasing, quarter 1 at 1:1). */
export const syntheticQuarterStart = (quarter: number) => Math.floor(((quarter - 1) * QURAN_AYAH_COUNT) / QURAN_QUARTER_COUNT) + 1;
/** Juz k starts at this global ayah (evenly spread, so most juz start mid-surah). */
export const syntheticJuzStart = (juz: number) => Math.floor(((juz - 1) * QURAN_AYAH_COUNT) / QURAN_JUZ_COUNT) + 1;
const markedAyahs: ReadonlySet<number> = (() => {
  const set = new Set<number>();
  for (let g = 1; g <= QURAN_AYAH_COUNT; g += 1) if (g % 41 === 5) set.add(g);
  for (let j = 1; j <= QURAN_JUZ_COUNT; j += 1) if (j % 3 === 0) set.add(syntheticJuzStart(j)); // these juz starts are MARKER_CONFIRMED
  return set;
})();
export const syntheticIsMarked = (global: number) => markedAyahs.has(global);

/** The words of an ayah as the official text writes them: optional leading quarter marker, the words, the end mark with the ayah number. */
export function syntheticAyahWords(surah: number, ayah: number): string[] {
  const global = SURAH_AYAH_COUNTS.slice(0, surah - 1).reduce((a, b) => a + b, 0) + ayah;
  const body = surah === 1 && ayah === 1 ? SYNTHETIC_BASMALA.split(' ') : Array.from({ length: 3 + (ayah % 4) }, (_, i) => `كلمة${'ب'.repeat(1 + ((surah + ayah + i) % 3))}`);
  return [...(markedAyahs.has(global) ? ['۞'] : []), ...body, `۝${indic(ayah)}`];
}
export const syntheticAyahText = (surah: number, ayah: number) => syntheticAyahWords(surah, ayah).join(' ');

interface SyntheticLine { kind: 'SURAH_HEADER' | 'BASMALA' | 'TEXT'; surah?: number; first?: [number, number]; last?: [number, number]; wordsFrom?: number; wordsTo?: number }

/** The synthetic layout as (page, line, ...) records: no ayah crosses a page (like the official layout). */
function syntheticLayout(): Array<SyntheticLine & { page: number; line: number }> {
  const raw: SyntheticLine[] = [];
  for (let s = 1; s <= 114; s += 1) {
    const count = SURAH_AYAH_COUNTS[s - 1]!;
    raw.push({ kind: 'SURAH_HEADER', surah: s });
    if (!SURAHS_WITHOUT_BASMALA_LINE.includes(s)) raw.push({ kind: 'BASMALA', surah: s });
    let a = 1;
    while (a <= count) {
      const n = syntheticAyahWords(s, a).filter((w) => w !== '۞').length;
      if (a % 5 === 0 && a < count) {
        raw.push({ kind: 'TEXT', first: [s, a], last: [s, a + 1] }); // one line holding two ayahs
        a += 2;
      } else if (a % 7 === 0 && n >= 2) {
        const half = Math.ceil(n / 2);
        raw.push({ kind: 'TEXT', first: [s, a], last: [s, a], wordsFrom: 0, wordsTo: half }); // an ayah spanning two lines
        raw.push({ kind: 'TEXT', first: [s, a], last: [s, a], wordsFrom: half, wordsTo: n });
        a += 1;
      } else {
        raw.push({ kind: 'TEXT', first: [s, a], last: [s, a] });
        a += 1;
      }
    }
  }
  // a page may only end where the next line starts a new ayah (or is a banner/basmala): never inside an ayah
  const startsFresh = (i: number) => i >= raw.length || raw[i]!.kind !== 'TEXT' || raw[i]!.wordsFrom === undefined || raw[i]!.wordsFrom === 0;
  const cuts: number[] = [];
  let previous = 0;
  for (let p = 1; p < QURAN_PAGE_COUNT; p += 1) {
    let cut = Math.max(previous + 1, Math.round((raw.length * p) / QURAN_PAGE_COUNT));
    while (!startsFresh(cut)) cut += 1;
    cuts.push(cut);
    previous = cut;
  }
  cuts.push(raw.length);
  const lines: Array<SyntheticLine & { page: number; line: number }> = [];
  let index = 0;
  cuts.forEach((end, p) => {
    let line = 1;
    for (; index < end; index += 1) lines.push({ ...raw[index]!, page: p + 1, line: line++ });
  });
  return lines;
}

export function buildSyntheticDataset(): Json {
  const surahs = SURAH_AYAH_COUNTS.map((ayahCount, i) => ({ number: i + 1, nameAr: syntheticSurahName(i + 1), ayahCount }));
  const lines = syntheticLayout().map((l) => {
    if (l.kind === 'TEXT') return { page: l.page, line: l.line, kind: 'TEXT', firstAyah: ref(...l.first!), lastAyah: ref(...l.last!) };
    return { page: l.page, line: l.line, kind: l.kind, surah: l.surah };
  });
  const ayahs: Json[] = [];
  SURAH_AYAH_COUNTS.forEach((count, i) => {
    for (let a = 1; a <= count; a += 1) ayahs.push({ surah: i + 1, ayah: a, text: syntheticAyahText(i + 1, a) });
  });
  const refOf = (g: number) => {
    const p = ayahPositionOf(g)!;
    return ref(p.surah, p.ayah);
  };
  return {
    format: 'qsms-quran-structure',
    formatVersion: 3,
    edition: { mushaf: 'MADINAH_MUSHAF', narration: 'HAFS_AN_ASIM', pages: 604 },
    source: { provider: 'SYNTHETIC TEST DATA', name: 'generated by tests/helpers/quran-fixture.ts', version: '1', retrievedOn: '2026-10-22', files: [{ name: 'synthetic.json', sha256: 'a'.repeat(64) }], attributions: [{ role: 'Synthetic test data', provider: 'tests', name: 'quran-fixture', version: '1', license: null, notice: null }] },
    surahs,
    ayahs,
    lines,
    juz: Array.from({ length: QURAN_JUZ_COUNT }, (_, k) => ({ juz: k + 1, start: refOf(syntheticJuzStart(k + 1)) })),
    quarters: Array.from({ length: QURAN_QUARTER_COUNT }, (_, i) => ({ quarter: i + 1, start: refOf(syntheticQuarterStart(i + 1)) })),
    quarterMarks: [...markedAyahs].sort((a, b) => a - b).map((g) => ({ start: refOf(g) })),
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// A SYNTHETIC source package in the shape of kfgqpc_hafs_v30.zip (JSON + CSV + DOCX), to test the converter without any real data.
// ---------------------------------------------------------------------------------------------------------------------------------------

export function buildZip(entries: ReadonlyArray<{ name: string; data: Buffer; deflate?: boolean }>): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const body = e.deflate ? deflateRawSync(e.data) : e.data;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(e.deflate ? 8 : 0, 8);
    local.writeUInt32LE(crc32(e.data), 14); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(e.data.length, 22); local.writeUInt16LE(name.length, 26);
    parts.push(local, name, body);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0); dir.writeUInt16LE(20, 4); dir.writeUInt16LE(20, 6); dir.writeUInt16LE(e.deflate ? 8 : 0, 10);
    dir.writeUInt32LE(crc32(e.data), 16); dir.writeUInt32LE(body.length, 20); dir.writeUInt32LE(e.data.length, 24); dir.writeUInt16LE(name.length, 28); dir.writeUInt32LE(offset, 42);
    central.push(dir, name);
    offset += 30 + name.length + body.length;
  }
  const centralBytes = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(centralBytes.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, centralBytes, end]);
}

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

const xmlText = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');

/** A synthetic Excel workbook (shared strings for text, raw numbers for numeric columns, like a real one). */
export function buildSyntheticXlsx(header: string[], rows: Array<Array<string | number>>, numericColumns: ReadonlySet<number>): Buffer {
  const shared: string[] = [];
  const idx = (t: string) => { let i = shared.indexOf(t); if (i < 0) { shared.push(t); i = shared.length - 1; } return i; };
  const letter = (c: number) => String.fromCharCode(65 + c);
  const cell = (c: number, r: number, v: string | number) => (numericColumns.has(c) && r > 1 ? `<c r="${letter(c)}${r}"><v>${v}</v></c>` : `<c r="${letter(c)}${r}" t="s"><v>${idx(String(v))}</v></c>`);
  const all = [header, ...rows];
  const sheet = `<?xml version="1.0"?><worksheet xmlns="x"><sheetData>${all.map((row, i) => `<row r="${i + 1}">${row.map((v, c) => cell(c, i + 1, v)).join('')}</row>`).join('')}</sheetData></worksheet>`;
  const sst = `<?xml version="1.0"?><sst xmlns="x">${shared.map((t) => `<si><t xml:space="preserve">${xmlText(t)}</t></si>`).join('')}</sst>`;
  return buildZip([
    { name: 'xl/worksheets/sheet1.xml', data: Buffer.from(sheet, 'utf8'), deflate: true },
    { name: 'xl/sharedStrings.xml', data: Buffer.from(sst, 'utf8'), deflate: true },
  ]);
}

/** A synthetic Tanzil-style quarter file. `tweak` produces the malformed variants the reader must reject. */
export function buildSyntheticTanzilXml(tweak: { duplicate?: boolean; missing?: boolean; outOfOrder?: boolean; badReference?: boolean; moveQuarter?: { quarter: number; surah: number; ayah: number } } = {}): Buffer {
  const quarters = Array.from({ length: QURAN_QUARTER_COUNT }, (_, i) => {
    const p = ayahPositionOf(syntheticQuarterStart(i + 1))!;
    return { index: i + 1, sura: p.surah, aya: p.ayah };
  });
  if (tweak.moveQuarter) Object.assign(quarters[tweak.moveQuarter.quarter - 1]!, { sura: tweak.moveQuarter.surah, aya: tweak.moveQuarter.ayah });
  if (tweak.duplicate) quarters[11]!.index = 11;
  if (tweak.missing) quarters.splice(50, 1);
  if (tweak.outOfOrder) [quarters[20], quarters[21]] = [quarters[21]!, quarters[20]!];
  if (tweak.badReference) quarters[30]!.aya = 9999;
  const body = quarters.map((q) => `\t\t<quarter index="${q.index}" sura="${q.sura}" aya="${q.aya}" />`).join('\r\n');
  return Buffer.from(`<?xml version="1.0" encoding="utf-8" ?>\r\n<quran type="metadata" version="1.0" copyright="(C) synthetic test" license="cc-by">\r\n\t<suras alias="chapters"><sura index="1" ayas="7" start="0" /></suras>\r\n\t<hizbs alias="groups">\r\n${body}\r\n\t</hizbs>\r\n</quran>\r\n`, 'utf8');
}

export function buildSyntheticPackage(tweak: { jozzSkew?: boolean; excelSkew?: boolean; csvLineShift?: boolean; dropBasmala?: boolean; wordChange?: boolean } = {}): { zip: Buffer; sha256: string; version: string; dataset: Json; tanzil: Buffer; tanzilSha256: string } {
  const layout = syntheticLayout();
  // ---- DOCX document.xml: one paragraph per banner / basmala line, one per run of text lines; <w:br/> between lines, <w:br w:type="page"/> at page ends
  const wordsOf = (s: number, a: number) => syntheticAyahWords(s, a);
  const pos = new Map<string, { first: { page: number; line: number }; last: { page: number; line: number } }>();
  const paragraphs: string[] = [];
  let body: string[] = [];
  const t = (text: string) => `<w:r><w:t xml:space="preserve">${xml(text)}</w:t></w:r>`;
  const flushBody = () => { if (body.length) paragraphs.push(`<w:p>${body.join('')}</w:p>`); body = []; };
  layout.forEach((l, i) => {
    const next = layout[i + 1];
    const pageEnds = next === undefined || next.page !== l.page;
    const brk = pageEnds ? '<w:r><w:br w:type="page"/></w:r>' : '<w:r><w:br/></w:r>';
    if (l.kind === 'SURAH_HEADER') { flushBody(); paragraphs.push(`<w:p>${t(`سُورَةُ ${syntheticSurahName(l.surah!)}`)}${pageEnds ? brk : ''}</w:p>`); return; }
    if (l.kind === 'BASMALA') { flushBody(); if (!(tweak.dropBasmala && l.surah === 2)) paragraphs.push(`<w:p>${t(SYNTHETIC_BASMALA)}${pageEnds ? brk : ''}</w:p>`); return; }
    const [s1, a1] = l.first!;
    const a2 = l.last![1]; // a text line never crosses a surah
    const tokens: string[] = [];
    for (let g = a1; g <= a2; g += 1) {
      const all = wordsOf(s1, g);
      const withoutMark = all.filter((x) => x !== '۞');
      if (l.wordsFrom === undefined) tokens.push(...all);
      else tokens.push(...(all[0] === '۞' && l.wordsFrom === 0 ? ['۞'] : []), ...withoutMark.slice(l.wordsFrom, l.wordsTo));
    }
    const mid = tweak.wordChange && s1 === 3 && a1 === 3 ? tokens.map((w, k) => (k === 1 ? `${w}خ` : w)) : tokens;
    const firstPos = { page: l.page, line: l.line };
    for (let g = a1; g <= a2; g += 1) {
      const key = `${s1}:${g}`;
      const entry = pos.get(key);
      if (!entry) pos.set(key, { first: firstPos, last: firstPos });
      else entry.last = firstPos;
    }
    body.push(t(mid.join(' ')));
    body.push(pageEnds ? brk : (layout[i + 1]!.kind === 'TEXT' ? brk : ''));
    if (layout[i + 1]?.kind !== 'TEXT') flushBody();
  });
  flushBody();
  const documentXml = `<?xml version="1.0"?><w:document xmlns:w="w"><w:body>${paragraphs.join('')}</w:body></w:document>`;
  const docx = buildZip([{ name: 'word/document.xml', data: Buffer.from(documentXml, 'utf8'), deflate: true }]);

  // ---- JSON/CSV rows
  const dataset = buildSyntheticDataset();
  const rows = (dataset.ayahs as Array<{ surah: number; ayah: number; text: string }>).map((a, i) => {
    const p = pos.get(`${a.surah}:${a.ayah}`)!;
    let jozz = 1;
    for (let j = 1; j <= QURAN_JUZ_COUNT; j += 1) if (i + 1 >= syntheticJuzStart(j)) jozz = j;
    return {
      id: i + 1, jozz: tweak.jozzSkew && i === 100 ? jozz + 5 : jozz, page: p.first.page, sura_no: a.surah, sura_name_en: `Surah ${a.surah}`, sura_name_ar: syntheticSurahName(a.surah),
      line_start: p.first.line, line_end: tweak.csvLineShift && i === 200 ? p.last.line + 1 : p.last.line, aya_no: a.ayah, aya_text_unicode: a.text, aya_text_emlaey: 'x',
    };
  });
  const csvHeader = 'id,jozz,page,sura_no,sura_name_en,sura_name_ar,line_start,line_end,aya_no,aya_text_unicode,aya_text_emlaey';
  const csv = [csvHeader, ...rows.map((r) => [r.id, r.jozz, r.page, r.sura_no, `"${r.sura_name_en}"`, `"${r.sura_name_ar}"`, r.line_start, r.line_end, r.aya_no, `"${r.aya_text_unicode}"`, r.aya_text_emlaey].join(','))].join('\r\n');
  const xlsxHeader = ['id', 'jozz', 'page', 'sura_no', 'sura_name_en', 'sura_name_ar', 'line_start', 'line_end', 'aya_no', 'aya_text_unicode', 'aya_text_emlaey'];
  const xlsx = buildSyntheticXlsx(
    xlsxHeader,
    rows.map((r, i) => [r.id, tweak.excelSkew && i === 300 ? r.jozz + 1 : r.jozz, r.page, r.sura_no, r.sura_name_en, r.sura_name_ar, r.line_start, r.line_end, r.aya_no, r.aya_text_unicode, r.aya_text_emlaey]),
    new Set([0, 1, 2, 3, 6, 7, 8]),
  );
  const zip = buildZip([
    { name: 'pkg-data/kfgqpc_hafs_v30.xlsx', data: xlsx, deflate: true },
    { name: 'pkg-data/kfgqpc_hafs_v30.json', data: Buffer.from(JSON.stringify(rows), 'utf8'), deflate: true },
    { name: 'pkg-data/kfgqpc_hafs_v30.csv', data: Buffer.from(csv, 'utf8'), deflate: true },
    { name: 'pkg-font/kfgqpc_hafs_v30.docx', data: docx },
  ]);
  const tanzil = buildSyntheticTanzilXml();
  return { zip, sha256: createHash('sha256').update(zip).digest('hex'), version: 'synthetic package', dataset, tanzil, tanzilSha256: createHash('sha256').update(tanzil).digest('hex') };
}
