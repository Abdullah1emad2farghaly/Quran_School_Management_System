import { listQueryParameters, ref, schema as s, type ErrorDoc, type ModuleApiDoc, type OperationDoc } from '../../../04-validation-api/public';
import { ASSIGNABLE_ROLE_CODES } from '../../../09-roles-permissions/public';
import { QuranPermissions } from '../../application/services/quran-authorization';
import { JUZ_VERIFICATIONS, LINE_KINDS, QURAN_AYAH_COUNT, QURAN_PAGE_COUNT, QURAN_SURAH_COUNT } from '../../domain/value-objects/quran-edition';
import { QURAN_AYAHS_SPEC } from './quran-routes';

const REFERENCE = 'Approved Module 21 decisions (project owner); docs/QURAN-STRUCTURE.md; docs/AUTHORIZATION-MATRIX.md (Quran structure 21)';
const NOTE = 'Example values are illustrative; the real values come from the imported dataset of the approved edition (Madinah Mushaf, Hafs from Asim, 604 pages).';

const READ_ONLY = {
  authentication: 'required' as const,
  roles: [...ASSIGNABLE_ROLE_CODES] as string[],
  scope: 'None: global reference data (no organization, school or ownership).',
  enforcement:
    'Authorization Engine permission (unscoped) granted to EVERY assignable role: all authenticated users may read. The data is immutable through the API (no write endpoint exists).',
  permissionId: QuranPermissions.READ,
  decision: 'APPROVED' as const,
  reference: REFERENCE,
};

const NOT_ALLOWED: ErrorDoc = { status: 403, codes: ['ACCESS_DENIED', 'PASSWORD_CHANGE_REQUIRED'], description: 'The caller has no role that may read the Quran structure, or the account must first change its initial password.' };
const notImported = 'QURAN_DATASET_NOT_IMPORTED';
const int = (name: string, description: string, example: string) => ({ [name]: { description, example, schema: s.string({ pattern: '^[1-9]\\d*$' }) } });

const refSchema = s.object({ surah: s.integer({ minimum: 1, maximum: 114 }), ayah: s.integer({ minimum: 1 }), globalPosition: s.integer({ minimum: 1, maximum: QURAN_AYAH_COUNT }) }, ['surah', 'ayah', 'globalPosition'], {
  description: 'An ayah position: surah, ayah and the global position (1..6236) of the canonical order.',
});
const surahSchema = s.object(
  { number: s.integer({ minimum: 1, maximum: QURAN_SURAH_COUNT }), nameAr: s.string({ example: 'الفاتحة' }), ayahCount: s.integer({ minimum: 1, example: 7 }), firstGlobalPosition: s.integer({ minimum: 1, maximum: QURAN_AYAH_COUNT }) },
  ['number', 'nameAr', 'ayahCount', 'firstGlobalPosition'],
);
const ayahSchema = s.object(
  {
    globalPosition: s.integer({ minimum: 1, maximum: QURAN_AYAH_COUNT }),
    surah: s.integer({ minimum: 1, maximum: 114 }),
    ayah: s.integer({ minimum: 1 }),
    text: s.string({ description: 'The official ayah text, verbatim (it ends with the end-of-ayah mark and number, and starts with the quarter marker when a quarter starts here).' }),
    firstPage: s.integer({ minimum: 1, maximum: QURAN_PAGE_COUNT }),
    firstLine: s.integer({ minimum: 1 }),
    lastPage: s.integer({ minimum: 1, maximum: QURAN_PAGE_COUNT }),
    lastLine: s.integer({ minimum: 1 }),
    juz: s.integer({ minimum: 1, maximum: 30, description: 'The juz of the ayah (the official KFGQPC Excel `jozz` value).' }),
    quarter: s.integer({ minimum: 1, maximum: 240, description: 'The quarter (rub\' al-hizb) containing the ayah, from the approved quarter source.' }),
    hizb: s.integer({ minimum: 1, maximum: 60, description: 'The hizb containing the quarter (4 quarters per hizb).' }),
    startsRubMarker: s.boolean({ description: 'The official text of this ayah starts with the printed quarter marker (a property of the text, not a quarter position).' }),
  },
  ['globalPosition', 'surah', 'ayah', 'text', 'firstPage', 'firstLine', 'lastPage', 'lastLine', 'juz', 'quarter', 'hizb', 'startsRubMarker'],
  { description: 'An ayah with the first and last page/line that carry it (an ayah can span lines and pages), its juz, its quarter and hizb.' },
);
const lineSchema = s.object(
  {
    globalLine: s.integer({ minimum: 1 }),
    page: s.integer({ minimum: 1, maximum: QURAN_PAGE_COUNT }),
    line: s.integer({ minimum: 1 }),
    kind: s.string({ enum: LINE_KINDS, description: 'TEXT carries ayahs; SURAH_HEADER is the surah banner; BASMALA is the separate basmala line.' }),
    surah: s.integer({ nullable: true, description: 'The surah of a SURAH_HEADER / BASMALA line; null for TEXT.' }),
    firstAyah: s.nullableRef('QuranAyahRef'),
    lastAyah: s.nullableRef('QuranAyahRef'),
  },
  ['globalLine', 'page', 'line', 'kind', 'surah', 'firstAyah', 'lastAyah'],
  { description: 'A line of the page layout. A TEXT line names the first and last ayah it touches (an ayah can continue from / into the neighbouring lines).' },
);
const pageSchema = s.object(
  { page: s.integer({ minimum: 1, maximum: QURAN_PAGE_COUNT }), lineCount: s.integer({ minimum: 1 }), firstAyah: ref('QuranAyahRef'), lastAyah: ref('QuranAyahRef'), lines: s.array(ref('QuranLine')) },
  ['page', 'lineCount', 'firstAyah', 'lastAyah', 'lines'],
);
const juzSchema = s.object(
  {
    juz: s.integer({ minimum: 1, maximum: 30 }),
    start: ref('QuranAyahRef'),
    verification: s.string({
      enum: JUZ_VERIFICATIONS,
      description:
        'INFORMATIONAL: how this juz start (the official KFGQPC Excel value, authoritative) relates to the quarter markers printed in the official text. MARKER_CONFIRMED: the start ayah\'s text starts with a printed marker. SURAH_START_NO_MARKER: the start is ayah 1 of a surah, where no marker is printed. MARKER_CONFLICT: the start is mid-surah and carries no printed marker (the printed marker is at another ayah); the juz value is not changed.',
    }),
  },
  ['juz', 'start', 'verification'],
);
const quarterSchema = s.object({ quarter: s.integer({ minimum: 1, maximum: 240 }), hizb: s.integer({ minimum: 1, maximum: 60 }), start: ref('QuranAyahRef') }, ['quarter', 'hizb', 'start'], {
  description: 'A quarter (rub\' al-hizb) record of the approved quarter source (all 240), where the quarter starts. The juz and the quarters come from different approved sources and are not reconciled.',
});
const quarterMarkSchema = s.object({ mark: s.integer({ minimum: 1, maximum: 240, description: 'Ordinal among the printed markers; NOT a quarter number.' }), start: ref('QuranAyahRef') }, ['mark', 'start'], {
  description: 'A quarter marker symbol printed in the official text (evidence about the text, in the order of the text). The quarter positions are the /quarters records.',
});
const datasetSchema = s.object(
  {
    editionCode: s.string({ example: 'MADINAH_MUSHAF_HAFS_604' }),
    source: s.object(
      {
        provider: s.string(),
        name: s.string(),
        version: s.string({ nullable: true }),
        url: s.string({ nullable: true }),
        license: s.string({ nullable: true }),
        retrievedOn: s.string({ nullable: true, description: 'ISO date (YYYY-MM-DD).' }),
        files: s.array(s.object({ name: s.string(), sha256: s.string() }, ['name', 'sha256'])),
        attributions: s.array(s.object({ role: s.string(), provider: s.string(), name: s.string(), version: s.string({ nullable: true }), license: s.string({ nullable: true }), notice: s.string({ nullable: true }) }, ['role', 'provider', 'name', 'version', 'license', 'notice'])),
      },
      ['provider', 'name', 'version', 'url', 'license', 'retrievedOn', 'files', 'attributions'],
    ),
    checksum: s.string({ description: 'SHA-256 of the imported file.' }),
    counts: s.object({ surahs: s.integer(), ayahs: s.integer(), pages: s.integer(), lines: s.integer(), quarters: s.integer(), quarterMarks: s.integer() }, ['surahs', 'ayahs', 'pages', 'lines', 'quarters', 'quarterMarks']),
    coverage: s.object(
      {
        quarters: s.object({ expected: s.integer({ example: 240 }), imported: s.integer() }, ['expected', 'imported'], { description: 'The quarter records imported against the 240 quarters of the Quran.' }),
        printedQuarterMarkers: s.integer({ description: 'The quarter marker symbols printed in the official text (evidence about the text).' }),
        juz: s.object(
          { total: s.integer({ example: 30 }), markerConfirmed: s.integer(), surahStartNoMarker: s.integer(), markerConflict: s.integer() },
          ['total', 'markerConfirmed', 'surahStartNoMarker', 'markerConflict'],
          { description: 'Informational relation of the 30 juz starts (official Excel values) to the printed markers (see /juz).' },
        ),
      },
      ['quarters', 'printedQuarterMarkers', 'juz'],
    ),
    importedAt: s.dateTime(),
  },
  ['editionCode', 'source', 'checksum', 'counts', 'coverage', 'importedAt'],
  { description: 'Attribution of the active dataset.' },
);

const refExample = { surah: 1, ayah: 1, globalPosition: 1 };
const ayahExample = { globalPosition: 1, surah: 1, ayah: 1, text: 'Example official text ۝١', firstPage: 1, firstLine: 2, lastPage: 1, lastLine: 2, juz: 1, quarter: 1, hizb: 1, startsRubMarker: false };
const lineExample = { globalLine: 2, page: 1, line: 2, kind: 'TEXT', surah: null, firstAyah: refExample, lastAyah: refExample };
const surahExample = { number: 1, nameAr: 'الفاتحة', ayahCount: 7, firstGlobalPosition: 1 };

const op = (o: OperationDoc): OperationDoc => o;
const base = { authorization: READ_ONLY };

/** OpenAPI contract of `/quran` (`quran-routes.ts`). Module 21: Quran structure (read-only). */
export const quranApiDoc: ModuleApiDoc = {
  moduleId: '21',
  mountPath: '/quran',
  tag: {
    name: 'Quran Structure',
    description:
      'Read-only reference data of the approved Quran edition (Madinah Mushaf, Hafs from Asim, 604 pages), taken from the official King Fahd Complex Hafs v30 package (surahs, ayahs with their official text, pages/faces with their lines, the juz starts) and the approved quarter source (all 240 quarters), with the global position of the canonical order. Readable by every authenticated user; immutable through the API.',
  },
  operations: [
    op({
      ...base, method: 'get', path: '/dataset', operationId: 'getQuranDataset', summary: 'Attribution of the imported Quran dataset',
      description: `The edition, the source (provider, name, version, license status, source files with their SHA-256), the SHA-256 of the imported dataset file, the row counts of the active import, the attribution of each source and the coverage of the quarters and juz. ${NOTE}`,
      success: { status: 200, description: 'The active dataset.', data: ref('QuranDataset'), example: { editionCode: 'MADINAH_MUSHAF_HAFS_604', source: { provider: 'Example provider', name: 'Example dataset', version: '1', url: null, license: null, retrievedOn: '2026-10-22', files: [{ name: 'example.csv', sha256: 'b'.repeat(64) }], attributions: [{ role: 'Example', provider: 'Example provider', name: 'Example dataset', version: null, license: null, notice: null }] }, checksum: 'a'.repeat(64), counts: { surahs: 114, ayahs: 6236, pages: 604, lines: 9046, quarters: 240, quarterMarks: 199 }, coverage: { quarters: { expected: 240, imported: 240 }, printedQuarterMarkers: 199, juz: { total: 30, markerConfirmed: 16, surahStartNoMarker: 9, markerConflict: 5 } }, importedAt: '2026-10-22T10:00:00.000Z' } },
      errors: [NOT_ALLOWED, { status: 404, codes: [notImported], description: 'Nothing has been imported yet.' }],
    }),
    op({
      ...base, method: 'get', path: '/surahs', operationId: 'listQuranSurahs', summary: 'The 114 surahs',
      description: 'Every surah in order, with its ayah count and the global position of its first ayah. Not paginated (114 items).',
      success: { status: 200, description: 'The surahs.', data: s.array(ref('QuranSurah')), example: [surahExample] },
      errors: [NOT_ALLOWED, { status: 404, codes: [notImported], description: 'Nothing has been imported yet.' }],
    }),
    op({
      ...base, method: 'get', path: '/surahs/:surah', operationId: 'getQuranSurah', summary: 'One surah',
      description: 'A surah by its number (1-114).',
      pathParams: int('surah', 'The surah number (1-114).', '1'),
      success: { status: 200, description: 'The surah.', data: ref('QuranSurah'), example: surahExample },
      errors: [NOT_ALLOWED, { status: 404, codes: [notImported, 'QURAN_SURAH_NOT_FOUND'], description: 'Nothing has been imported yet, or the surah does not exist.' }],
    }),
    op({
      ...base, method: 'get', path: '/surahs/:surah/ayahs', operationId: 'listQuranSurahAyahs', summary: 'The ayahs of a surah',
      description: 'A paginated list of the surah\'s ayahs in order (`sort=-ayah` for descending).',
      pathParams: int('surah', 'The surah number (1-114).', '1'), query: listQueryParameters(QURAN_AYAHS_SPEC),
      success: { status: 200, description: 'A page of ayahs.', paginated: true, data: ref('QuranAyah'), example: ayahExample },
      errors: [NOT_ALLOWED, { status: 404, codes: [notImported, 'QURAN_SURAH_NOT_FOUND'], description: 'Nothing has been imported yet, or the surah does not exist.' }],
    }),
    op({
      ...base, method: 'get', path: '/surahs/:surah/ayahs/:ayah', operationId: 'getQuranAyah', summary: 'One ayah by surah and ayah number',
      description: 'An ayah with its official text, its page/line span, its juz and whether a printed quarter marker starts at it.',
      pathParams: { ...int('surah', 'The surah number (1-114).', '1'), ...int('ayah', 'The ayah number within the surah.', '1') },
      success: { status: 200, description: 'The ayah.', data: ref('QuranAyah'), example: ayahExample },
      errors: [NOT_ALLOWED, { status: 404, codes: [notImported, 'QURAN_AYAH_NOT_FOUND'], description: 'Nothing has been imported yet, or the surah has no such ayah.' }],
    }),
    op({
      ...base, method: 'get', path: '/ayahs/:position', operationId: 'getQuranAyahByPosition', summary: 'One ayah by global position',
      description: 'The ayah at the global position (1..6236) of the canonical order.',
      pathParams: int('position', 'The global position, 1..6236.', '1'),
      success: { status: 200, description: 'The ayah.', data: ref('QuranAyah'), example: ayahExample },
      errors: [NOT_ALLOWED, { status: 404, codes: [notImported, 'QURAN_AYAH_NOT_FOUND'], description: 'Nothing has been imported yet, or the position does not exist.' }],
    }),
    op({
      ...base, method: 'get', path: '/pages/:page', operationId: 'getQuranPage', summary: 'A page / face with its lines',
      description: `A page (1..${QURAN_PAGE_COUNT}) with every line of its layout (banner, basmala and text lines) and the first and last ayah on it. ${NOTE}`,
      pathParams: int('page', `The page number, 1..${QURAN_PAGE_COUNT}.`, '1'),
      success: { status: 200, description: 'The page.', data: ref('QuranPage'), example: { page: 1, lineCount: 1, firstAyah: refExample, lastAyah: refExample, lines: [lineExample] } },
      errors: [NOT_ALLOWED, { status: 404, codes: [notImported, 'QURAN_PAGE_NOT_FOUND'], description: 'Nothing has been imported yet, or the page does not exist.' }],
    }),
    op({
      ...base, method: 'get', path: '/juz', operationId: 'listQuranJuz', summary: 'The 30 juz starts',
      description: 'Every juz with the ayah where it starts: the values of the official KFGQPC Excel file, used as stated. `verification` is informational (relation to the printed markers) and never changes a value.',
      success: { status: 200, description: 'The juz.', data: s.array(ref('QuranJuz')), example: [{ juz: 1, start: refExample, verification: 'SURAH_START_NO_MARKER' }] },
      errors: [NOT_ALLOWED, { status: 404, codes: [notImported], description: 'Nothing has been imported yet.' }],
    }),
    op({
      ...base, method: 'get', path: '/quarters', operationId: 'listQuranQuarters', summary: 'The 240 quarters (rub\' al-hizb)',
      description: 'All 240 quarter records of the approved quarter source, in order, with their hizb and the ayah where each starts.',
      success: { status: 200, description: 'The quarters.', data: s.array(ref('QuranQuarter')), example: [{ quarter: 1, hizb: 1, start: refExample }] },
      errors: [NOT_ALLOWED, { status: 404, codes: [notImported], description: 'Nothing has been imported yet.' }],
    }),
    op({
      ...base, method: 'get', path: '/quarters/:quarter', operationId: 'getQuranQuarter', summary: 'One quarter',
      description: 'A quarter by its number (1-240).',
      pathParams: int('quarter', 'The quarter number (1-240).', '1'),
      success: { status: 200, description: 'The quarter.', data: ref('QuranQuarter'), example: { quarter: 1, hizb: 1, start: refExample } },
      errors: [NOT_ALLOWED, { status: 404, codes: [notImported, 'QURAN_QUARTER_NOT_FOUND'], description: 'Nothing has been imported yet, or the quarter does not exist.' }],
    }),
    op({
      ...base, method: 'get', path: '/quarter-marks', operationId: 'listQuranQuarterMarks', summary: 'The quarter markers printed in the official text',
      description: 'The ayahs whose official text starts with the printed quarter marker symbol, in the order of the text. This is evidence about the text; the quarter positions are the /quarters records and may differ (for example quarter 106).',
      success: { status: 200, description: 'The printed quarter markers.', data: s.array(ref('QuranQuarterMark')), example: [{ mark: 1, start: { surah: 2, ayah: 26, globalPosition: 33 } }] },
      errors: [NOT_ALLOWED, { status: 404, codes: [notImported], description: 'Nothing has been imported yet.' }],
    }),
  ],
  schemas: { QuranAyahRef: refSchema, QuranSurah: surahSchema, QuranAyah: ayahSchema, QuranLine: lineSchema, QuranPage: pageSchema, QuranJuz: juzSchema, QuranQuarter: quarterSchema, QuranQuarterMark: quarterMarkSchema, QuranDataset: datasetSchema },
};
