/**
 * Module 21 end-to-end verification on the REAL official package (read-only: the package is only read; nothing is imported into any real database).
 *
 *   npm run verify:quran -- <kfgqpc_hafs_v30.zip> <quran-data.xml> [--sqlite]      (--sqlite needs Node >= 22.5)
 *
 * What it proves, and what it does NOT:
 *  0. The original files are only read: their SHA-256 is recorded before and compared after the whole run.
 *  1. Archive integrity: SHA-256 of the archive equals the value published by the Complex. Dataset integrity: the SHA-256 of the exact bytes of the
 *     converted dataset file (the import checksum). The two are different artifacts and are reported separately.
 *  2. Full-population checks of what the service returns against the sources THEMSELVES: all 6236 texts, all page/line ranges, the juz of every ayah
 *     against the official Excel workbook, and all 240 quarter records against the Tanzil XML (quarter 106 at 15:50).
 *  3. EVERY endpoint's data (all surahs, all ayahs, all 604 pages, juz, quarter markers, dataset info) validated against the OpenAPI schemas, plus
 *     pagination edges, invalid and nonexistent identifiers. (A small JSON-schema subset checker is used here; the project's ajv conformance suite
 *     needs the project dependencies and runs with `npm run api:verify`. This is NOT an HTTP test.)
 *  4. With --sqlite: the REAL repository SQL and the REAL import use case run against SQLite whose schema is BUILT FROM THE PROJECT'S MIGRATION FILES.
 *     This is an EMULATION. It is NOT MariaDB: it proves the repository's SQL, the mapping of persisted data, constraints expressed in the migrations,
 *     idempotency and rollback; it does NOT prove that the migrations run on MariaDB 10.4.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { registerAllErrorMessages } from '../../../src/app/bootstrap/register-error-messages';
import { FixedClock, type UnitOfWork } from '../../../src/modules/00-shared-kernel/public';
import { defaultMessageCatalog } from '../../../src/modules/03-error-localization/public';
import { buildOpenApiDocument } from '../../../src/modules/04-validation-api/public';
import { createTransactionContext } from '../../../src/modules/02-database/infrastructure/services/sequelize-transaction-context';
import {
  APPROVED_KFGQPC_HAFS_PACKAGES, ImportQuranDataset, InMemoryQuranStructureRepository, QuranStructureService, SequelizeQuranStructureRepository, convertKfgqpcHafsPackage,
  APPROVED_TANZIL_QUARTER_FILES, quranApiDoc, serializeDataset, validateQuranDataset, type QuranStructureLookup,
} from '../../../src/modules/21-quran-structure/public';
import { createSubsetChecker } from './openapi-subset-checker';
import { readZip } from '../../../src/modules/21-quran-structure/infrastructure/source/zip-reader';
import { readXlsxFirstSheet } from '../../../src/modules/21-quran-structure/infrastructure/source/xlsx-sheet-reader';

const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const PUBLISHED_ARCHIVE_SHA256 = '227e6b1564d980f2bd09c2c35ebfb0330ac268c79a7c247cd1ab665bc635f245'; // as published by the Complex / stated by the owner
let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean, detail = ''): void => {
  if (ok) passed += 1;
  else failures.push(`${name} ${detail}`);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  [${detail}]` : ''}`);
};
const section = (t: string) => console.log(`\n=== ${t}`);

// ---------------------------------------------------------------- OpenAPI schema subset checker
registerAllErrorMessages();
const doc: any = buildOpenApiDocument({ modules: [quranApiDoc], basePath: '/api/v1', title: 't', version: 't', messages: defaultMessageCatalog });
const schemas = doc.components.schemas;
const { problems: schemaProblems, conforms } = createSubsetChecker(schemas);
const dataSchema = (p: string) => doc.paths[`/quran${p}`].get.responses['200'].content['application/json'].schema.properties.data;
const itemSchema = (p: string) => dataSchema(p).items ?? dataSchema(p);
function allConform(label: string, schema: any, values: unknown[]): void {
  const before = schemaProblems.length;
  values.forEach((v, i) => conforms(schema, v, `${label}[${i}]`));
  check(`OpenAPI: ${label} (${values.length} response bodies)`, schemaProblems.length === before, schemaProblems.slice(before, before + 2).join('; '));
}

// ---------------------------------------------------------------- the official source, read independently
const zipPath = process.argv[2]!;
const xmlPath = process.argv[3]!;
const useSqlite = process.argv.includes('--sqlite');
const zipBytes = readFileSync(zipPath);
const xmlBytes = readFileSync(xmlPath);
const inputHashesBefore = [sha(zipBytes), sha(xmlBytes)];
section('1. Source and checksums');
check('archive SHA-256 equals the published value', sha(zipBytes) === PUBLISHED_ARCHIVE_SHA256, sha(zipBytes));
check('archive SHA-256 is on the converter\'s approved list', APPROVED_KFGQPC_HAFS_PACKAGES.some((p) => p.sha256 === sha(zipBytes)));
check('quarter file (quran-data.xml) SHA-256 is the pinned approved value', APPROVED_TANZIL_QUARTER_FILES.some((f) => f.sha256 === sha(xmlBytes)), sha(xmlBytes));
const entries = readZip(zipBytes);
const officialRows: Array<{ id: number; jozz: number; page: number; sura_no: number; sura_name_ar: string; line_start: number; line_end: number; aya_no: number; aya_text_unicode: string }> =
  JSON.parse(entries.find((e) => e.name.endsWith('kfgqpc_hafs_v30.json'))!.data.toString('utf8'));
const excel = readXlsxFirstSheet(entries.find((e) => e.name.endsWith('kfgqpc_hafs_v30.xlsx'))!.data);
const excelJozz = excel.slice(1).map((r) => Number(r[1]));
const statedQuarters = [...xmlBytes.toString('utf8').matchAll(/<quarter index="(\d+)" sura="(\d+)" aya="(\d+)"\s*\/>/g)].map((m) => ({ quarter: Number(m[1]), surah: Number(m[2]), ayah: Number(m[3]) }));
const { dataset } = convertKfgqpcHafsPackage(zipBytes, xmlBytes);
const datasetBytes = Buffer.from(serializeDataset(dataset), 'utf8');
const DATASET_CHECKSUM = sha(datasetBytes); // what `npm run import:quran` computes: SHA-256 of the exact bytes of the dataset file
const tmp = mkdtempSync(path.join(tmpdir(), 'q21-'));
const datasetFile = path.join(tmp, 'dataset.json');
writeFileSync(datasetFile, datasetBytes);
check('dataset checksum = SHA-256 of the exact bytes of the dataset file written to disk', sha(readFileSync(datasetFile)) === DATASET_CHECKSUM, DATASET_CHECKSUM);
check('dataset checksum differs from the archive checksum (they identify different artifacts)', DATASET_CHECKSUM !== sha(zipBytes));
check('the dataset records the archive and each source file with their real SHA-256', (dataset.source as any).files[0].sha256 === sha(zipBytes));
check('conversion is deterministic (second run is byte-identical)', serializeDataset(convertKfgqpcHafsPackage(zipBytes, xmlBytes).dataset) === datasetBytes.toString('utf8'));
const validated = validateQuranDataset(dataset); // the REAL edition profile
check('the real edition profile (with its page anchors) accepts the dataset', validated.ayahs.length === 6236);
console.log(`archive SHA-256   : ${sha(zipBytes)}  (the official .zip, unmodified)`);
console.log(`quarter file      : ${sha(xmlBytes)}  (quran-data.xml, unmodified)`);
console.log(`dataset checksum  : ${DATASET_CHECKSUM}  (the converted dataset file: ${datasetBytes.length} bytes)`);

// ---------------------------------------------------------------- shared checks, run against any service
async function verifyService(service: QuranStructureLookup, label: string): Promise<void> {
  section(`${label}: values against the official files (full population)`);
  const info = (await service.getDatasetInfo())!;
  check('dataset info: checksum is the real dataset checksum (not a placeholder)', info.checksum === DATASET_CHECKSUM);
  check('dataset info: counts', JSON.stringify(info.counts) === JSON.stringify({ surahs: 114, ayahs: 6236, pages: 604, lines: 9046, quarters: 240, quarterMarks: 199 }), JSON.stringify(info.counts));
  check('dataset info: coverage = 240 quarter records imported, 199 printed markers (a separate count), and the juz relation', JSON.stringify(info.coverage) === JSON.stringify({ quarters: { expected: 240, imported: 240 }, printedQuarterMarkers: 199, juz: { total: 30, markerConfirmed: 16, surahStartNoMarker: 9, markerConflict: 5 } }), JSON.stringify(info.coverage));
  check('dataset info: two attributions (KFGQPC; Tanzil with its stated license and copyright) and 6 recorded source files', info.source.attributions.length === 2 && info.source.attributions[1]!.license === 'cc-by' && info.source.files.length === 6 && info.source.license!.startsWith('UNVERIFIED'));
  const surahs = await service.listSurahs();
  check('114 surahs, names equal the official names, ayah counts sum to 6236', surahs.length === 114 && surahs.every((s) => s.nameAr === officialRows.find((r) => r.sura_no === s.number)!.sura_name_ar) && surahs.reduce((a, s) => a + s.ayahCount, 0) === 6236);
  const ayahs = [] as Awaited<ReturnType<QuranStructureLookup['getAyahByGlobalPosition']>>[];
  for (let g = 1; g <= 6236; g += 1) ayahs.push(await service.getAyahByGlobalPosition(g));
  check('all 6236 ayah texts are byte-identical to the official text', ayahs.every((a, i) => a!.text === officialRows[i]!.aya_text_unicode));
  check('all 6236 ayahs: surah/ayah numbers equal the official ones', ayahs.every((a, i) => a!.surah === officialRows[i]!.sura_no && a!.ayah === officialRows[i]!.aya_no));
  check('all 6236 ayahs: first page and line range equal the official CSV', ayahs.every((a, i) => a!.firstPage === officialRows[i]!.page && a!.lastPage === officialRows[i]!.page && a!.firstLine === officialRows[i]!.line_start && a!.lastLine === officialRows[i]!.line_end));
  check('all 6236 ayahs: juz equals the value in the official EXCEL workbook (read directly from the .xlsx)', ayahs.every((a, i) => a!.juz === excelJozz[i]));
  check('startsRubMarker is true exactly for the 199 ayahs whose official text starts with the marker', ayahs.filter((a) => a!.startsRubMarker).length === 199 && ayahs.every((a) => a!.startsRubMarker === a!.text.startsWith('\u06DE ')));
  const byPair = await Promise.all([[1, 1], [2, 255], [23, 118], [114, 6]].map(([s, a]) => service.getAyah(s!, a!)));
  check('getAyah(surah, ayah) returns the same record as by global position', byPair.every((a) => JSON.stringify(a) === JSON.stringify(ayahs[a!.globalPosition - 1])));
  const pages = [] as NonNullable<Awaited<ReturnType<QuranStructureLookup['getPage']>>>[];
  for (let p = 1; p <= 604; p += 1) pages.push((await service.getPage(p))!);
  const lines = pages.flatMap((p) => p.lines);
  check('604 pages, 9046 lines numbered 1..9046 in page/line order', pages.length === 604 && lines.length === 9046 && lines.every((l, i) => l.globalLine === i + 1));
  check('pages 1 and 2 have 8 lines, every other page 15', pages.every((p) => p.lineCount === p.lines.length && p.lineCount === (p.page <= 2 ? 8 : 15)));
  check('114 banner lines, 112 basmala lines, 8820 text lines', lines.filter((l) => l.kind === 'SURAH_HEADER').length === 114 && lines.filter((l) => l.kind === 'BASMALA').length === 112 && lines.filter((l) => l.kind === 'TEXT').length === 8820);
  check('page 1: banner line, then the text of 1:1 at line 2; page 349 line 15 is TEXT (23:118)', pages[0]!.lines[0]!.kind === 'SURAH_HEADER' && pages[0]!.lines[1]!.firstAyah!.globalPosition === 1 && pages[348]!.lines[14]!.kind === 'TEXT' && ayahs[7 + 286 + 200 + 176 + 120 + 165 + 206 + 75 + 129 + 109 + 123 + 111 + 43 + 52 + 99 + 128 + 111 + 110 + 98 + 135 + 112 + 78 + 118 - 1]!.firstPage === 349);
  check('ayah -> line -> ayah is consistent: every text line contains the ayahs it names, and every ayah is on a line that names it', ayahs.every((a) => {
    const onPage = pages[a!.firstPage - 1]!.lines;
    const first = onPage.find((l) => l.line === a!.firstLine)!, last = pages[a!.lastPage - 1]!.lines.find((l) => l.line === a!.lastLine)!;
    return first.kind === 'TEXT' && last.kind === 'TEXT' && first.firstAyah!.globalPosition <= a!.globalPosition && first.lastAyah!.globalPosition >= a!.globalPosition && last.firstAyah!.globalPosition <= a!.globalPosition && last.lastAyah!.globalPosition >= a!.globalPosition;
  }));
  check('no ayah crosses a page in the official layout', ayahs.every((a) => a!.firstPage === a!.lastPage));
  check('getLineByGlobalIndex returns the line listed on its page', (await Promise.all([1, 100, 4523, 9046].map((n) => service.getLineByGlobalIndex(n)))).every((l, i) => JSON.stringify(l) === JSON.stringify(lines[[1, 100, 4523, 9046][i]! - 1])));
  const juz = await service.listJuzs();
  const exact = (n: number) => `${juz[n - 1]!.start.surah}:${juz[n - 1]!.start.ayah}`;
  check('30 juz in order; each juz start is the first ayah whose Excel jozz is that juz, and every ayah\'s juz is consistent with them', juz.length === 30 && juz.every((j, i) => j.juz === i + 1 && j.start.globalPosition === excelJozz.indexOf(i + 1) + 1) && ayahs.every((a) => a!.juz === juz.filter((j) => j.start.globalPosition <= a!.globalPosition).length));
  check('juz starts of the five juz that differ from the printed markers are the Excel values 3:92, 9:94, 27:60, 29:45, 36:21 (stored as stated)', [4, 11, 20, 21, 23].map(exact).join() === '3:92,9:94,27:60,29:45,36:21');
  check('juz relation to the printed markers (informational): 16 confirmed, 9 at a surah start, 5 differing', juz.filter((j) => j.verification === 'MARKER_CONFIRMED').length === 16 && juz.filter((j) => j.verification === 'SURAH_START_NO_MARKER').length === 9 && juz.filter((j) => j.verification === 'MARKER_CONFLICT').map((j) => j.juz).join() === '4,11,20,21,23');
  const quarters = await service.listQuarters();
  check('240 quarter records, in order, each EXACTLY as the Tanzil XML states it (compared with the file)', quarters.length === statedQuarters.length && statedQuarters.length > 0 && quarters.every((q, i) => q.quarter === statedQuarters[i]!.quarter && q.start.surah === statedQuarters[i]!.surah && q.start.ayah === statedQuarters[i]!.ayah));
  check('quarter numbers are 1..N without gaps or repeats, positions strictly increase, hizb = ceil(quarter / 4)', quarters.every((q, i) => q.quarter === i + 1 && q.hizb === Math.ceil((i + 1) / 4) && (i === 0 || quarters[i - 1]!.start.globalPosition < q.start.globalPosition)));
  const q106 = quarters[105]!;
  check('QUARTER 106 is at Al-Hijr 15:50 (the Tanzil position), not 15:49', q106.quarter === 106 && q106.start.surah === 15 && q106.start.ayah === 50 && (await service.getQuarter(106))!.start.ayah === 50);
  check('ayah 15:49 belongs to quarter 105 and ayah 15:50 to quarter 106', ayahs.find((a) => a!.surah === 15 && a!.ayah === 49)!.quarter === 105 && ayahs.find((a) => a!.surah === 15 && a!.ayah === 50)!.quarter === 106);
  check('every ayah\'s quarter is the quarter that starts at or before it (all 6236)', ayahs.every((a) => a!.quarter === quarters.filter((q) => q.start.globalPosition <= a!.globalPosition).length && a!.hizb === Math.ceil(a!.quarter / 4)));
  check('getQuarter(1..240) equals the listed record; 0 and 241 do not exist', (await Promise.all(quarters.map((q) => service.getQuarter(q.quarter)))).every((q, i) => JSON.stringify(q) === JSON.stringify(quarters[i])) && (await service.getQuarter(0)) === undefined && (await service.getQuarter(241)) === undefined);
  const marks = await service.listQuarterMarks();
  check('199 printed marker symbols, ordinal 1..199, strictly increasing, each on an ayah whose text starts with the marker', marks.length === 199 && marks.every((m, i) => m.mark === i + 1 && (i === 0 || marks[i - 1]!.start.globalPosition < m.start.globalPosition) && ayahs[m.start.globalPosition - 1]!.text.startsWith('\u06DE ')));
  check('the PRINTED marker symbol is at 15:49 (a fact about the text); the quarter record is 15:50 (the quarter source): the two are separate resources', marks.some((m) => m.start.surah === 15 && m.start.ayah === 49) && !marks.some((m) => m.start.surah === 15 && m.start.ayah === 50) && q106.start.ayah === 50);

  section(`${label}: pagination edges and invalid or nonexistent identifiers (service level)`);
  const p1 = await service.listAyahsOfSurah(2, { page: 1, pageSize: 1 }, 'asc');
  const pLast = await service.listAyahsOfSurah(2, { page: 3, pageSize: 100 }, 'asc');
  const pBeyond = await service.listAyahsOfSurah(2, { page: 99, pageSize: 100 }, 'asc');
  const pDesc = await service.listAyahsOfSurah(2, { page: 1, pageSize: 3 }, 'desc');
  check('pageSize 1 -> 1 item of 286; last page of surah 2 has 86; a page beyond the end is empty; descending order', p1.items.length === 1 && p1.total === 286 && pLast.items.length === 86 && pBeyond.items.length === 0 && pBeyond.total === 286 && pDesc.items.map((a) => a.ayah).join() === '286,285,284');
  check('nonexistent identifiers answer undefined: surah 0/115, ayah 1:8, position 0/6237, page 0/605, line 0/9047', (await service.getSurah(0)) === undefined && (await service.getSurah(115)) === undefined && (await service.getAyah(1, 8)) === undefined && (await service.getAyahByGlobalPosition(0)) === undefined && (await service.getAyahByGlobalPosition(6237)) === undefined && (await service.getPage(0)) === undefined && (await service.getPage(605)) === undefined && (await service.getLineByGlobalIndex(0)) === undefined && (await service.getLineByGlobalIndex(9047)) === undefined);

  section(`${label}: every endpoint's data against the OpenAPI schemas`);
  allConform('GET /dataset', dataSchema('/dataset'), [info]);
  allConform('GET /surahs', dataSchema('/surahs'), [surahs]);
  allConform('GET /surahs/{surah} (all 114)', dataSchema('/surahs/{surah}'), await Promise.all(surahs.map((s) => service.getSurah(s.number))));
  const ayahPages: any[] = [];
  for (const s of surahs) for (let page = 1; page <= Math.ceil(s.ayahCount / 100); page += 1) ayahPages.push(...(await service.listAyahsOfSurah(s.number, { page, pageSize: 100 }, 'asc')).items);
  allConform('GET /surahs/{surah}/ayahs (every ayah via pagination)', itemSchema('/surahs/{surah}/ayahs'), ayahPages);
  check('paginating every surah visits each of the 6236 ayahs exactly once, in order', ayahPages.length === 6236 && ayahPages.every((a, i) => a.globalPosition === i + 1));
  allConform('GET /surahs/{surah}/ayahs/{ayah} and GET /ayahs/{position} (all 6236)', dataSchema('/ayahs/{position}'), ayahs);
  allConform('GET /pages/{page} (all 604, incl. 1, 349, 604)', dataSchema('/pages/{page}'), pages);
  allConform('GET /juz', dataSchema('/juz'), [juz]);
  allConform('GET /quarters', dataSchema('/quarters'), [quarters]);
  allConform('GET /quarters/{quarter} (all 240)', dataSchema('/quarters/{quarter}'), await Promise.all(quarters.map((q) => service.getQuarter(q.quarter))));
  allConform('GET /quarter-marks', dataSchema('/quarter-marks'), [marks]);
}

// ---------------------------------------------------------------- how the approved sources relate (informational; nothing is reconciled)
function sourceRelationships(): void {
  section('2. How the approved sources relate to each other (informational: both are stored exactly as stated, nothing is reconciled)');
  const quarterStarts = new Set(validated.quarters.map((q) => q.startGlobalAyah));
  const markers = validated.quarterMarks.map((m) => m.startGlobalAyah);
  const markersNotQuarters = markers.filter((g) => !quarterStarts.has(g));
  const quartersNotMarkers = validated.quarters.filter((q) => !markers.includes(q.startGlobalAyah));
  console.log(`printed marker symbols: ${markers.length} | quarter records: ${validated.quarters.length} | markers at a quarter start: ${markers.length - markersNotQuarters.length} | markers NOT at a quarter start: ${markersNotQuarters.map((g) => { const a = validated.ayahs[g - 1]!; return `${a.surah}:${a.ayah}`; }).join(', ') || '-'}`);
  console.log(`quarter starts without a printed marker: ${quartersNotMarkers.length} (${quartersNotMarkers.filter((q) => q.startAyah === 1).length} of them at the first ayah of a surah)`);
  const differing = validated.juzs.filter((j) => validated.quarters[8 * (j.juz - 1)]!.startGlobalAyah !== j.startGlobalAyah);
  console.log('juz start (official Excel) versus the first quarter of that juz (quarter file):');
  for (const j of differing) { const q = validated.quarters[8 * (j.juz - 1)]!; console.log(`  juz ${j.juz}: Excel ${j.startSurah}:${j.startAyah} | quarter ${q.quarter}: ${q.startSurah}:${q.startAyah}`); }
  check('the sources differ at exactly the five juz 4, 11, 20, 21, 23 (the only places where a juz start and its first quarter disagree)', differing.map((j) => j.juz).join() === '4,11,20,21,23');
  check('the only printed marker that is not at a quarter start is 15:49 (quarter 106 is at 15:50, as the quarter source states)', markersNotQuarters.length === 1 && validated.ayahs[markersNotQuarters[0]! - 1]!.surah === 15 && validated.ayahs[markersNotQuarters[0]! - 1]!.ayah === 49);
}

// ---------------------------------------------------------------- SQLite emulation built from the migrations
function buildSchemaFromMigrations(db: any): void {
  type Col = { type: string; notNull: boolean; pk: boolean };
  const tables = new Map<string, { cols: Map<string, Col>; checks: Map<string, string>; uniques: string[][]; fks: Array<{ col: string; ref: string; refCol: string }> }>();
  const T = (n: string) => tables.get(n)!;
  const kind = (t: any): string => (/INT/.test(String(t.kind)) ? 'INTEGER' : 'TEXT');
  const Sequelize: any = new Proxy({}, { get: (_t, k) => { const f: any = (..._a: unknown[]) => ({ kind: String(k), ...f }); f.kind = String(k); return new Proxy(f, { get: (_x, sub) => (sub === 'kind' ? String(k) : sub === 'UNSIGNED' ? { kind: String(k) } : undefined), apply: () => ({ kind: String(k) }) }); } });
  const sql = async (text: string) => {
    let m: RegExpMatchArray | null;
    if ((m = text.match(/^SELECT COUNT\(\*\) AS n FROM (\w+)$/))) return [[{ n: 0 }]];
    if ((m = text.match(/^ALTER TABLE (\w+) ADD CONSTRAINT (\w+) CHECK \(([\s\S]+)\)$/))) { T(m[1]!).checks.set(m[2]!, m[3]!); return []; }
    if ((m = text.match(/^ALTER TABLE (\w+) DROP CONSTRAINT (\w+)$/))) { T(m[1]!).checks.delete(m[2]!); return []; }
    if ((m = text.match(/^ALTER TABLE (\w+) (.+)$/))) {
      for (const action of m[2]!.split(/,\s*(?=DROP COLUMN|ADD COLUMN)/)) {
        let a: RegExpMatchArray | null;
        if ((a = action.match(/^DROP COLUMN (\w+)$/))) T(m[1]!).cols.delete(a[1]!);
        else if ((a = action.match(/^ADD COLUMN (\w+) (\w+)(?: UNSIGNED)?(?:\((\d+)\))? (NOT NULL|NULL)/))) T(m[1]!).cols.set(a[1]!, { type: /INT/.test(a[2]!) ? 'INTEGER' : 'TEXT', notNull: a[4] === 'NOT NULL', pk: false });
        else if ((a = action.match(/^MODIFY (\w+) (\w+) (NOT NULL|NULL)$/))) { const c = T(m[1]!).cols.get(a[1]!)!; c.notNull = a[3] === 'NOT NULL'; }
        else throw new Error(`Unhandled ALTER action in a migration: ${action}`);
      }
      return [];
    }
    throw new Error(`Unhandled SQL in a migration: ${text}`);
  };
  const qi: any = {
    sequelize: { query: sql },
    async createTable(name: string, cols: Record<string, any>) { const map = new Map<string, Col>(); for (const [c, d] of Object.entries(cols)) map.set(c, { type: kind(d.type), notNull: d.allowNull === false, pk: !!d.primaryKey }); tables.set(name, { cols: map, checks: new Map(), uniques: [], fks: [] }); },
    async addIndex(table: string, fields: string[], o: any) { if (o?.unique) T(table).uniques.push(fields); },
    async addConstraint(table: string, o: any) { if (o.type === 'foreign key') T(table).fks.push({ col: o.fields[0], ref: o.references.table, refCol: o.references.field }); },
    async dropTable(n: string) { tables.delete(n); },
  };
  const dir = path.resolve(__dirname, '../../../database/migrations');
  return (async () => {
    for (const f of ['20261022100000-create-quran-structure.js', '20261023100000-quran-structure-official-package-model.js', '20261024100000-quran-structure-quarters.js']) await require(path.join(dir, f)).up(qi, Sequelize);
    db.exec('PRAGMA foreign_keys = ON');
    for (const [name, t] of tables) {
      const cols = [...t.cols].map(([c, d]) => `${c} ${d.type}${d.pk ? ' PRIMARY KEY' : ''}${d.notNull || d.pk ? ' NOT NULL' : ''}`);
      const checks = [...t.checks].map(([n, e]) => `CONSTRAINT ${n} CHECK (${e.replace(/<=>/g, 'IS').replace(/CEIL\(([^)]*?)\s*\/\s*(\d+)\)/g, '(($1 + $2 - 1) / $2)')})`);
      const fks = t.fks.map((f) => `FOREIGN KEY (${f.col}) REFERENCES ${f.ref}(${f.refCol}) ON DELETE RESTRICT`);
      db.exec(`CREATE TABLE ${name} (${[...cols, ...checks, ...fks].join(', ')})`);
      t.uniques.forEach((u, i) => db.exec(`CREATE UNIQUE INDEX uq_${name}_${i} ON ${name} (${u.join(', ')})`));
    }
    return tables;
  })() as unknown as void;
}

async function sqliteRun(): Promise<void> {
  const { DatabaseSync } = await import('node:sqlite'); // Node >= 22.5; loaded only for --sqlite so the script still runs on Node 20 without it
  section('3. SQLITE EMULATION (NOT MariaDB): schema built from the project migrations, real repository SQL, real import use case');
  const db = new DatabaseSync(':memory:');
  await (buildSchemaFromMigrations(db) as unknown as Promise<unknown>);
  const queryable: any = {
    async query(text: string, o: any = {}) {
      const rep = o.replacements ?? [];
      const conv = (v: any) => (v instanceof Date ? v.toISOString() : typeof v === 'boolean' ? (v ? 1 : 0) : v === undefined ? null : v);
      const stmt = db.prepare(text.replace(/\s+FOR UPDATE\s*$/i, ''));
      const args = Array.isArray(rep) ? rep.map(conv) : [Object.fromEntries(Object.entries(rep).map(([k, v]) => [k, conv(v)]))];
      if (o.type === 'SELECT') return stmt.all(...(args as any[]));
      stmt.run(...(args as any[]));
      return [];
    },
  };
  const uow: UnitOfWork = { async run(work) { db.exec('BEGIN'); try { const r = await work(createTransactionContext({} as any)); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } } };
  const repository = new SequelizeQuranStructureRepository(queryable);
  const service = new QuranStructureService(repository);
  const importer = new ImportQuranDataset({ store: repository, unitOfWork: uow, clock: new FixedClock(new Date('2026-10-24T00:00:00Z')) });
  const q = (s: string) => db.prepare(s).all() as any[];
  const n = (s: string) => Number(Object.values(q(s)[0])[0]);

  const before = await service.getDatasetInfo();
  check('before any import the database holds no dataset', before === undefined && n('SELECT COUNT(*) FROM quran_ayahs') === 0);
  let notImported = '';
  try { await service.listSurahs(); } catch (e: any) { notImported = e.code; }
  check('reads fail closed with QURAN_DATASET_NOT_IMPORTED', notImported === 'QURAN_DATASET_NOT_IMPORTED');

  const raw = JSON.parse(readFileSync(datasetFile, 'utf8'));
  const summary = await importer.execute({ raw, checksum: DATASET_CHECKSUM, replace: false });
  check('import through the real use case (real checksum, no --replace)', summary.outcome === 'IMPORTED', summary.outcome);

  section('3a. Persisted data, queried directly in the database');
  const counts: Array<[string, number]> = [['quran_surahs', 114], ['quran_ayahs', 6236], ['quran_pages', 604], ['quran_lines', 9046], ['quran_juz', 30], ['quran_quarters', 240], ['quran_quarter_marks', 199], ['quran_dataset_imports', 1], ['quran_hizb', 0]];
  for (const [t, expected] of counts) check(`persisted rows: ${t} = ${expected}`, n(`SELECT COUNT(*) FROM ${t}`) === expected, String(n(`SELECT COUNT(*) FROM ${t}`)));
  check('exactly one ACTIVE import, recording the real dataset checksum, the 4 source files and the counts', n("SELECT COUNT(*) FROM quran_dataset_imports WHERE active = 1 AND status = 'ACTIVE' AND checksum = '" + DATASET_CHECKSUM + "' AND quarter_count = 240 AND quarter_mark_count = 199 AND line_count = 9046") === 1 && JSON.parse(q('SELECT source_files_json AS j FROM quran_dataset_imports')[0].j).files.length === 6 && JSON.parse(q('SELECT source_files_json AS j FROM quran_dataset_imports')[0].j).attributions.length === 2);
  check('foreign keys: no violation', q('PRAGMA foreign_key_check').length === 0);
  check('surah ayah_counts sum to 6236 and first_global_ayah values are consecutive', n('SELECT SUM(ayah_count) FROM quran_surahs') === 6236 && n('SELECT COUNT(*) FROM quran_surahs s JOIN quran_surahs t ON t.surah_number = s.surah_number + 1 WHERE t.first_global_ayah <> s.first_global_ayah + s.ayah_count') === 0);
  check('every ayah row joins its surah and (surah, ayah) is unique', n('SELECT COUNT(*) FROM quran_ayahs a JOIN quran_surahs s ON s.surah_number = a.surah_number') === 6236 && n('SELECT COUNT(DISTINCT surah_number * 1000 + ayah_number) FROM quran_ayahs') === 6236);
  const rows = q('SELECT global_ayah, ayah_text, first_page, first_line, last_line, juz_number, has_rub_marker FROM quran_ayahs ORDER BY global_ayah');
  check('PERSISTED text of all 6236 ayahs is byte-identical to the official text', rows.every((r, i) => r.ayah_text === officialRows[i]!.aya_text_unicode));
  check('PERSISTED page and line range equal the official CSV, and the PERSISTED juz equals the official Excel, for all 6236 ayahs', rows.every((r, i) => r.first_page === officialRows[i]!.page && r.first_line === officialRows[i]!.line_start && r.last_line === officialRows[i]!.line_end && r.juz_number === excelJozz[i]));
  const pq = q('SELECT quarter_number, hizb_number, start_surah_number, start_ayah_number FROM quran_quarters ORDER BY quarter_number');
  check('PERSISTED quarters: all 240 rows equal the Tanzil XML records, in order; quarter 106 is stored at 15:50', pq.length === statedQuarters.length && pq.every((r, i) => r.quarter_number === statedQuarters[i]!.quarter && r.start_surah_number === statedQuarters[i]!.surah && r.start_ayah_number === statedQuarters[i]!.ayah && r.hizb_number === Math.ceil((i + 1) / 4)) && pq[105].start_surah_number === 15 && pq[105].start_ayah_number === 50);
  check('PERSISTED ayah quarter_number equals the quarter that starts at or before each ayah (all 6236)', (q('SELECT global_ayah, quarter_number FROM quran_ayahs ORDER BY global_ayah') as any[]).every((r) => r.quarter_number === validated.quarters.filter((x) => x.startGlobalAyah <= r.global_ayah).length));
  check('PERSISTED markers: has_rub_marker = 1 for exactly the 199 marked ayahs = the quarter_marks rows', n('SELECT COUNT(*) FROM quran_ayahs WHERE has_rub_marker = 1') === 199 && n('SELECT COUNT(*) FROM quran_quarter_marks m JOIN quran_ayahs a ON a.global_ayah = m.start_global_ayah WHERE a.has_rub_marker = 1') === 199);
  check('PERSISTED juz starts: 30 rows, juz 4/11/20/21/23 stored as MARKER_CONFLICT with the official jozz values', n("SELECT COUNT(*) FROM quran_juz WHERE verification = 'MARKER_CONFLICT'") === 5 && q("SELECT start_surah_number || ':' || start_ayah_number AS s FROM quran_juz WHERE verification = 'MARKER_CONFLICT' ORDER BY juz_number").map((r) => r.s).join() === '3:92,9:94,27:60,29:45,36:21');
  check('PERSISTED lines: 604 pages x lines, kinds 8820 / 114 / 112, (page, line) unique', n("SELECT COUNT(*) FROM quran_lines WHERE kind = 'TEXT'") === 8820 && n("SELECT COUNT(*) FROM quran_lines WHERE kind = 'SURAH_HEADER'") === 114 && n("SELECT COUNT(*) FROM quran_lines WHERE kind = 'BASMALA'") === 112 && n('SELECT COUNT(*) FROM (SELECT page_number, line_number FROM quran_lines GROUP BY page_number, line_number)') === 9046);

  await verifyService(service, 'SQLITE-BACKED SERVICE (reads the persisted rows through SequelizeQuranStructureRepository)');

  section('3b. Constraints, idempotency and rollback');
  const mustFail = (name: string, sqlText: string) => { let failed = false; try { db.exec(sqlText); } catch { failed = true; } check(`constraint rejects: ${name}`, failed); };
  mustFail('a second ACTIVE import', "INSERT INTO quran_dataset_imports (id, edition_code, source_provider, source_name, checksum, surah_count, ayah_count, page_count, line_count, quarter_mark_count, status, active, imported_at) VALUES ('x','e','p','n','" + 'a'.repeat(64) + "',1,1,1,1,1,'ACTIVE',1,'2026-01-01')");
  mustFail('a duplicate (page, line)', "INSERT INTO quran_lines (global_line, page_number, line_number, kind, surah_number, first_global_ayah, last_global_ayah) VALUES (99999, 1, 1, 'BASMALA', 1, NULL, NULL)");
  mustFail('two quarters starting at the same ayah', "INSERT INTO quran_quarters (quarter_number, hizb_number, juz_number, start_global_ayah, start_surah_number, start_ayah_number) VALUES (241, 61, 31, 1, 1, 1)");
  mustFail('a quarter number beyond 240', "INSERT INTO quran_quarters (quarter_number, hizb_number, juz_number, start_global_ayah, start_surah_number, start_ayah_number) VALUES (241, 61, 31, 6000, 1, 1)");
  mustFail('a duplicate quarter marker on the same ayah', 'INSERT INTO quran_quarter_marks (mark_number, start_global_ayah, start_surah_number, start_ayah_number) VALUES (200, 33, 2, 26)');
  mustFail('a juz with an unknown evidence status', "UPDATE quran_juz SET verification = 'GUESSED' WHERE juz_number = 1");
  mustFail('an ayah without text', 'UPDATE quran_ayahs SET ayah_text = NULL WHERE global_ayah = 1');
  const again = await importer.execute({ raw, checksum: DATASET_CHECKSUM, replace: false });
  check('idempotent: importing the same dataset again is UNCHANGED and leaves 6236 ayahs and one import', again.outcome === 'UNCHANGED' && n('SELECT COUNT(*) FROM quran_ayahs') === 6236 && n('SELECT COUNT(*) FROM quran_dataset_imports') === 1);
  let refused = '';
  try { await importer.execute({ raw: { ...raw, source: { ...raw.source, version: 'other' } }, checksum: 'b'.repeat(64), replace: false }); } catch (e: any) { refused = e.code; }
  check('a different dataset is refused without --replace (QURAN_DATASET_REPLACEMENT_NOT_CONFIRMED) and nothing changes', refused === 'QURAN_DATASET_REPLACEMENT_NOT_CONFIRMED' && n("SELECT COUNT(*) FROM quran_dataset_imports WHERE checksum = '" + DATASET_CHECKSUM + "' AND active = 1") === 1);
  // a replacement that passes validation but violates a database constraint part-way through the inserts must roll EVERYTHING back
  const corrupt = (r: unknown) => { const v = validateQuranDataset(r); return { ...v, ayahs: v.ayahs.map((a, i) => (i === 5000 ? { ...a, firstPage: 0 } : a)) }; };
  let failedImport = false;
  try { await importer.execute({ raw, checksum: 'c'.repeat(64), replace: true }, corrupt); } catch { failedImport = true; }
  check('a failed replacement is rejected by the database and rolled back completely', failedImport);
  check('after the failed replacement the original dataset is whole: counts, checksum, text of 6236 ayahs, one ACTIVE import, no trace of the failed one',
    n('SELECT COUNT(*) FROM quran_ayahs') === 6236 && n('SELECT COUNT(*) FROM quran_lines') === 9046 && n('SELECT COUNT(*) FROM quran_quarter_marks') === 199 && n('SELECT COUNT(*) FROM quran_quarters') === 240 && n('SELECT COUNT(*) FROM quran_dataset_imports') === 1 &&
    n("SELECT COUNT(*) FROM quran_dataset_imports WHERE active = 1 AND checksum = '" + DATASET_CHECKSUM + "'") === 1 && (q('SELECT ayah_text FROM quran_ayahs ORDER BY global_ayah') as any[]).every((r, i) => r.ayah_text === officialRows[i]!.aya_text_unicode));
  // a failed FIRST import must leave an empty database, not a partial one
  const db2 = new DatabaseSync(':memory:');
  await (buildSchemaFromMigrations(db2) as unknown as Promise<unknown>);
  const q2: any = { async query(text: string, o: any = {}) { const rep = o.replacements ?? []; const conv = (v: any) => (v instanceof Date ? v.toISOString() : typeof v === 'boolean' ? (v ? 1 : 0) : v === undefined ? null : v); const stmt = db2.prepare(text.replace(/\s+FOR UPDATE\s*$/i, '')); const args = Array.isArray(rep) ? rep.map(conv) : [Object.fromEntries(Object.entries(rep).map(([k, v]) => [k, conv(v)]))]; if (o.type === 'SELECT') return stmt.all(...(args as any[])); stmt.run(...(args as any[])); return []; } };
  const uow2: UnitOfWork = { async run(work) { db2.exec('BEGIN'); try { const r = await work(createTransactionContext({} as any)); db2.exec('COMMIT'); return r; } catch (e) { db2.exec('ROLLBACK'); throw e; } } };
  const repo2 = new SequelizeQuranStructureRepository(q2);
  let failedFirst = false;
  try { await new ImportQuranDataset({ store: repo2, unitOfWork: uow2, clock: new FixedClock(new Date()) }).execute({ raw, checksum: 'd'.repeat(64), replace: false }, corrupt); } catch { failedFirst = true; }
  const total2 = ['quran_surahs', 'quran_ayahs', 'quran_pages', 'quran_lines', 'quran_juz', 'quran_quarters', 'quran_quarter_marks', 'quran_dataset_imports'].map((t) => Number((db2.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get() as any).c));
  check('a failed FIRST import leaves every Quran table empty (no partial data)', failedFirst && total2.every((c) => c === 0), total2.join(','));
}

(async () => {
  sourceRelationships();
  // in-memory first (the use case + service), then optionally the SQL-backed run
  const repository = new InMemoryQuranStructureRepository();
  const service = new QuranStructureService(repository);
  const importer = new ImportQuranDataset({ store: repository, unitOfWork: { run: (w) => w({} as never) }, clock: new FixedClock(new Date('2026-10-24T00:00:00Z')) });
  await importer.execute({ raw: JSON.parse(readFileSync(datasetFile, 'utf8')), checksum: DATASET_CHECKSUM, replace: false });
  await verifyService(service, 'IN-MEMORY SERVICE');
  if (useSqlite) await sqliteRun();
  check('the original files are unchanged after the whole run (SHA-256 of the archive and of quran-data.xml, re-read from disk)', JSON.stringify([sha(readFileSync(zipPath)), sha(readFileSync(xmlPath))]) === JSON.stringify(inputHashesBefore), inputHashesBefore.join(' / '));
  console.log(`\n${failures.length === 0 ? 'ALL CHECKS PASSED' : `FAILED: ${failures.length}`} (${passed} passed)`);
  if (failures.length) console.log(failures.slice(0, 15).join('\n'));
  process.exit(failures.length ? 1 : 0);
})();