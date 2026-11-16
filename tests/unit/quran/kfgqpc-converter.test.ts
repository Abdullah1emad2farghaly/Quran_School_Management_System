import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readDocxLines } from '../../../src/modules/21-quran-structure/infrastructure/source/docx-layout-reader';
import { parseCsv } from '../../../src/modules/21-quran-structure/infrastructure/source/kfgqpc-hafs-v30-converter';
import { readXlsxFirstSheet } from '../../../src/modules/21-quran-structure/infrastructure/source/xlsx-sheet-reader';
import { crc32, readZip } from '../../../src/modules/21-quran-structure/infrastructure/source/zip-reader';
import { APPROVED_KFGQPC_HAFS_PACKAGES, ayahPositionOf, APPROVED_TANZIL_QUARTER_FILES, ImportQuranDataset, InMemoryQuranStructureRepository, QuranDatasetValidationError, QuranStructureService, convertKfgqpcHafsPackage, readTanzilQuarters, serializeDataset, validateQuranDataset } from '../../../src/modules/21-quran-structure/public';
import { FixedClock } from '../../../src/modules/00-shared-kernel/public';
import { SYNTHETIC_PROFILE, buildSyntheticPackage, buildSyntheticTanzilXml, buildSyntheticXlsx, buildZip, syntheticQuarterStart } from '../../helpers/quran-fixture';

const approve = (pkg: { sha256: string; version: string }) => [{ fileName: 'synthetic.zip', sha256: pkg.sha256, version: pkg.version }];
const approveQuarters = (pkg: { tanzilSha256: string }) => [{ fileName: 'quran-data.xml', sha256: pkg.tanzilSha256 }];
const problemsOf = (fn: () => unknown): string[] => {
  try {
    fn();
  } catch (error) {
    if (error instanceof QuranDatasetValidationError) return [...error.problems];
    throw error;
  }
  return [];
};

describe('zip reader', () => {
  it('reads stored and deflated entries and verifies size and CRC-32', () => {
    const zip = buildZip([{ name: 'a/one.txt', data: Buffer.from('hello'), deflate: false }, { name: 'two.txt', data: Buffer.from('مرحبا '.repeat(50)), deflate: true }]);
    const entries = readZip(zip);
    expect(entries.map((e) => e.name)).toEqual(['a/one.txt', 'two.txt']);
    expect(entries[0]!.data.toString()).toBe('hello');
    expect(entries[1]!.data.toString()).toBe('مرحبا '.repeat(50));
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926); // the standard CRC-32 check value
  });

  it('refuses a corrupted entry and a file that is not a ZIP', () => {
    const zip = buildZip([{ name: 'one.txt', data: Buffer.from('hello world'), deflate: false }]);
    const bad = Buffer.from(zip);
    bad[30 + 'one.txt'.length + 2] ^= 0xff; // flip a byte of the stored data
    expect(() => readZip(bad)).toThrow('integrity');
    expect(() => readZip(Buffer.from('not a zip at all'))).toThrow('Not a ZIP');
  });
});

describe('docx layout reader', () => {
  const xml = (inner: string) => `<w:document><w:body>${inner}</w:body></w:document>`;
  it('turns line breaks, page breaks and paragraph ends into (page, line)', () => {
    const lines = readDocxLines(
      xml('<w:p><w:r><w:t>banner</w:t></w:r><w:r><w:br w:type="page"/></w:r></w:p><w:p><w:r><w:t>a</w:t></w:r><w:r><w:t xml:space="preserve"> b</w:t></w:r><w:r><w:br/></w:r><w:r><w:t>c &amp; d</w:t></w:r></w:p><w:p><w:r><w:t>e</w:t></w:r></w:p>'),
    );
    expect(lines.map((l) => [l.page, l.line, l.text, l.paragraph])).toEqual([[1, 1, 'banner', 0], [2, 1, 'a b', 1], [2, 2, 'c & d', 1], [2, 3, 'e', 2]]);
  });
  it('ignores empty lines and treats a non-breaking space as a space', () => {
    const lines = readDocxLines(xml('<w:p><w:r><w:br/></w:r><w:r><w:t>x\u00a0y</w:t></w:r><w:r><w:br/></w:r></w:p>'));
    expect(lines.map((l) => [l.line, l.text])).toEqual([[1, 'x y']]);
  });
});

describe('csv parser', () => {
  it('handles quotes, doubled quotes, commas and newlines inside fields', () => {
    expect(parseCsv('a,b,c\r\n1,"x, ""y""",3\n"line1\nline2",5,6\n')).toEqual([['a', 'b', 'c'], ['1', 'x, "y"', '3'], ['line1\nline2', '5', '6']]);
  });
});

describe('xlsx reader', () => {
  it('reads shared strings, raw numbers and inline strings exactly as stored, and leaves absent cells empty', () => {
    const xlsx = buildSyntheticXlsx(['id', 'name'], [[1, 'أ & ب'], [2, 'x']], new Set([0]));
    expect(readXlsxFirstSheet(xlsx)).toEqual([['id', 'name'], ['1', 'أ & ب'], ['2', 'x']]);
    const inline = buildZip([{ name: 'xl/worksheets/sheet1.xml', data: Buffer.from('<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>q</t></is></c><c r="C1"><v>7</v></c></row></sheetData></worksheet>') }]);
    expect(readXlsxFirstSheet(inline)).toEqual([['q', '', '7']]);
  });
  it('refuses a workbook without a first worksheet', () => {
    expect(() => readXlsxFirstSheet(buildZip([{ name: 'other.xml', data: Buffer.from('x') }]))).toThrow('first worksheet');
  });
});

describe('Tanzil quarter reader (records are read as stated, never corrected)', () => {
  it('reads the 240 records and the attributes the file states', () => {
    const file = readTanzilQuarters(buildSyntheticTanzilXml().toString('utf8'));
    expect(file.quarters).toHaveLength(240);
    expect(file.quarters[0]).toEqual({ index: 1, surah: 1, ayah: 1 });
    expect(file.meta).toEqual({ version: '1.0', copyright: '(C) synthetic test', license: 'cc-by' });
  });
  it('rejects a missing quarter section, a duplicate, a gap, a record out of order and an invalid reference', () => {
    expect(problemsOf(() => readTanzilQuarters('<quran></quran>')).join()).toContain('<hizbs>');
    expect(problemsOf(() => readTanzilQuarters('<nothing/>')).join()).toContain('<quran> root');
    const bad = (t: Parameters<typeof buildSyntheticTanzilXml>[0]) => problemsOf(() => readTanzilQuarters(buildSyntheticTanzilXml(t).toString('utf8'))).join('\n');
    expect(bad({ duplicate: true })).toContain('appears more than once');
    expect(bad({ missing: true })).toContain('none missing');
    expect(bad({ outOfOrder: true })).toMatch(/must be 1\.\.N in file order|does not come after/);
    expect(bad({ badReference: true })).toContain('is not an ayah of the Hafs count');
  });
  it('does NOT treat a count as proof: a file with 239 records is read as 239 and the dataset validator rejects it', () => {
    const file = readTanzilQuarters(buildSyntheticTanzilXml({ moveQuarter: { quarter: 240, surah: 114, ayah: 6 } }).toString('utf8'));
    expect(file.quarters).toHaveLength(240);
    expect(file.quarters[239]).toEqual({ index: 240, surah: 114, ayah: 6 });
  });
});

describe('convertKfgqpcHafsPackage on a SYNTHETIC package (the machinery, not Quran data)', () => {
  const pkg = buildSyntheticPackage();
  const convert = (p = pkg, tanzil = p.tanzil) => convertKfgqpcHafsPackage(p.zip, tanzil, approve(p), approveQuarters(p));

  it('converts, passes the same validation as an import, and reports its cross-checks', () => {
    const { dataset, report } = convert();
    expect(dataset).toMatchObject({ format: 'qsms-quran-structure', formatVersion: 3 });
    expect(dataset.ayahs).toEqual(pkg.dataset.ayahs);
    expect(dataset.lines).toEqual(pkg.dataset.lines);
    expect(dataset.juz).toEqual(pkg.dataset.juz);
    expect(dataset.quarters).toEqual(pkg.dataset.quarters);
    expect(dataset.quarterMarks).toEqual(pkg.dataset.quarterMarks);
    expect(validateQuranDataset(dataset, SYNTHETIC_PROFILE).quarters).toHaveLength(240);
    expect(report.counts).toMatchObject({ surahs: 114, ayahs: 6236, pages: 604, banners: 114, basmalas: 112, quarters: 240 });
    expect(Object.values(report.crossChecks).every((v) => v.startsWith('passed'))).toBe(true);
  });

  it('takes the juz from the Excel file and the quarters from the quarter file, and records both attributions with every source file hash', () => {
    const source = convert().dataset.source as { provider: string; license: string; files: Array<{ name: string; sha256: string }>; attributions: Array<{ role: string; provider: string; license: string | null; notice: string | null }> };
    expect(source.provider).toBe('King Fahd Glorious Quran Printing Complex');
    expect(source.license).toMatch(/^UNVERIFIED/);
    expect(source.files.map((f) => f.name)).toEqual(['synthetic.zip', 'kfgqpc_hafs_v30.json', 'kfgqpc_hafs_v30.csv', 'kfgqpc_hafs_v30.xlsx', 'kfgqpc_hafs_v30.docx', 'quran-data.xml']);
    expect(source.files[0]!.sha256).toBe(pkg.sha256);
    expect(source.files[5]!.sha256).toBe(pkg.tanzilSha256);
    expect(source.attributions.map((a) => a.provider)).toEqual(['King Fahd Glorious Quran Printing Complex', 'Tanzil Project (tanzil.net)']);
    expect(source.attributions[1]).toMatchObject({ license: 'cc-by', notice: '(C) synthetic test' });
  });

  it('follows the quarter file in every disagreement: a quarter moved in the file is imported where the FILE puts it (like quarter 106)', () => {
    const shifted = ayahPositionOf(syntheticQuarterStart(106) + 1)!; // one ayah after the synthetic default, as quarter 106 is one ayah after the printed marker in the real data
    const moved = buildSyntheticTanzilXml({ moveQuarter: { quarter: 106, surah: shifted.surah, ayah: shifted.ayah } });
    const p = { ...pkg, tanzil: moved, tanzilSha256: createHash('sha256').update(moved).digest('hex') };
    expect((convert(p, moved).dataset.quarters as Array<{ quarter: number; start: { surah: number; ayah: number } }>)[105]).toEqual({ quarter: 106, start: { surah: shifted.surah, ayah: shifted.ayah } });
  });

  it('is deterministic: the same inputs give byte-identical output', () => {
    expect(serializeDataset(convert().dataset)).toBe(serializeDataset(convert().dataset));
  });

  it('never modifies its inputs', () => {
    const zipBefore = createHash('sha256').update(pkg.zip).digest('hex');
    const xmlBefore = createHash('sha256').update(pkg.tanzil).digest('hex');
    convert();
    expect([createHash('sha256').update(pkg.zip).digest('hex'), createHash('sha256').update(pkg.tanzil).digest('hex')]).toEqual([zipBefore, xmlBefore]);
  });

  it('refuses a package or a quarter file that is not an approved one (the real lists pin exactly one file each)', () => {
    expect(problemsOf(() => convertKfgqpcHafsPackage(pkg.zip, pkg.tanzil)).join('\n')).toContain('is not an approved');
    expect(problemsOf(() => convertKfgqpcHafsPackage(pkg.zip, Buffer.from('<quran/>'), approve(pkg))).join('\n')).toContain('not an approved quarter source file');
    expect(APPROVED_KFGQPC_HAFS_PACKAGES.map((p) => p.sha256)).toEqual(['227e6b1564d980f2bd09c2c35ebfb0330ac268c79a7c247cd1ab665bc635f245']);
    expect(APPROVED_TANZIL_QUARTER_FILES.map((f) => f.sha256)).toEqual(['8867c1d88191472adec9db694b3cd9f135b1a2ef580574d32cf888dcb22c5c7a']);
  });

  it('REPORTS a discrepancy between the Excel and the CSV/JSON and stops: it never silently corrects', () => {
    const bad = buildSyntheticPackage({ excelSkew: true });
    const text = problemsOf(() => convert(bad)).join('\n');
    expect(text).toContain('the Excel "jozz"');
    expect(text).toContain('reported, not corrected');
  });

  it('stops on malformed quarter files (duplicate, gap, out of order, invalid reference)', () => {
    for (const t of [{ duplicate: true }, { missing: true }, { outOfOrder: true }, { badReference: true }] as const) {
      const xml = buildSyntheticTanzilXml(t);
      const p = { ...pkg, tanzil: xml, tanzilSha256: createHash('sha256').update(xml).digest('hex') };
      expect(problemsOf(() => convert(p, xml)).length).toBeGreaterThan(0);
    }
  });

  it('stops when the CSV disagrees with the DOCX layout (a line shifted in the CSV)', () => {
    const bad = buildSyntheticPackage({ csvLineShift: true });
    expect(problemsOf(() => convert(bad)).join('\n')).toMatch(/the CSV says page \d+ lines \d+-\d+; the DOCX layout says/);
  });

  it('stops when a word of the DOCX differs from the official text', () => {
    expect(problemsOf(() => convert(buildSyntheticPackage({ wordChange: true }))).join('\n')).toContain('the DOCX has');
  });

  it('stops when the jozz field skips a juz', () => {
    expect(problemsOf(() => convert(buildSyntheticPackage({ jozzSkew: true }))).join('\n')).toContain('"jozz"');
  });

  it('stops when a basmala line is missing from the layout', () => {
    expect(problemsOf(() => convert(buildSyntheticPackage({ dropBasmala: true }))).join('\n')).toContain('basmala lines');
  });

  it('stops when the package is corrupted', () => {
    const bad = Buffer.from(pkg.zip);
    bad[200] ^= 0xff;
    expect(() => convertKfgqpcHafsPackage(bad, pkg.tanzil, [{ fileName: 'x', sha256: 'whatever', version: 'x' }], approveQuarters(pkg))).toThrow();
  });
});

// Optional: runs the converter on the REAL approved files when their paths are given. Not part of the default run (the files are not in the repository).
//   QSMS_KFGQPC_PACKAGE=/path/to/kfgqpc_hafs_v30.zip QSMS_TANZIL_XML=/path/to/quran-data.xml npm test -- tests/unit/quran/kfgqpc-converter.test.ts
describe.skipIf(!process.env.QSMS_KFGQPC_PACKAGE || !process.env.QSMS_TANZIL_XML)('REAL approved files (kfgqpc_hafs_v30.zip + Tanzil quran-data.xml)', () => {
  const zip = () => readFileSync(process.env.QSMS_KFGQPC_PACKAGE!);
  const xml = () => readFileSync(process.env.QSMS_TANZIL_XML!);
  const convert = () => convertKfgqpcHafsPackage(zip(), xml());
  const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

  it('leaves the original files untouched (SHA-256 before and after, and equal to the pinned values)', () => {
    const before = [sha(zip()), sha(xml())];
    convert();
    expect([sha(zip()), sha(xml())]).toEqual(before);
    expect(before).toEqual([APPROVED_KFGQPC_HAFS_PACKAGES[0]!.sha256, APPROVED_TANZIL_QUARTER_FILES[0]!.sha256]);
  });

  it('converts, every cross-check passes and the real edition profile accepts the result', () => {
    const { dataset, report } = convert();
    const validated = validateQuranDataset(dataset);
    expect(report.counts).toEqual({ surahs: 114, ayahs: 6236, pages: 604, lines: 9046, banners: 114, basmalas: 112, textLines: 8820, quarters: 240, quarterMarks: 199 });
    expect(validated.pages).toHaveLength(604);
    expect(Object.values(report.crossChecks).every((v) => v.startsWith('passed'))).toBe(true);
  });

  it('is deterministic', () => {
    expect(serializeDataset(convert().dataset)).toBe(serializeDataset(convert().dataset));
  });

  it('imports ALL 240 quarter records exactly as the Tanzil file states them (compared with the file, not with a constant)', () => {
    const stated = [...xml().toString('utf8').matchAll(/<quarter index="(\d+)" sura="(\d+)" aya="(\d+)"\s*\/>/g)].map((m) => ({ quarter: Number(m[1]), start: { surah: Number(m[2]), ayah: Number(m[3]) } }));
    expect(stated.length).toBeGreaterThan(0);
    expect(convert().dataset.quarters).toEqual(stated);
    expect(stated.map((q) => q.quarter)).toEqual(stated.map((_, i) => i + 1));
  });

  it('keeps quarter 106 at Al-Hijr 15:50 (the quarter file), never 15:49', async () => {
    const { dataset } = convert();
    expect((dataset.quarters as Array<{ quarter: number; start: { surah: number; ayah: number } }>)[105]).toEqual({ quarter: 106, start: { surah: 15, ayah: 50 } });
    const repository = new InMemoryQuranStructureRepository();
    const importer = new ImportQuranDataset({ store: repository, unitOfWork: { run: (w) => w({} as never) }, clock: new FixedClock(new Date('2026-10-24T00:00:00Z')) });
    await importer.execute({ raw: dataset, checksum: createHash('sha256').update(serializeDataset(dataset), 'utf8').digest('hex'), replace: false });
    const service = new QuranStructureService(repository);
    expect(await service.getQuarter(106)).toEqual({ quarter: 106, hizb: 27, start: { surah: 15, ayah: 50, globalPosition: (await service.getAyah(15, 50))!.globalPosition } });
    expect((await service.getAyah(15, 49))!.quarter).toBe(105);
    expect((await service.getAyah(15, 50))!.quarter).toBe(106);
  });

  it('takes the juz exactly from the official Excel: every ayah, compared with the workbook itself', async () => {
    const entries = readZip(zip());
    const sheet = readXlsxFirstSheet(entries.find((e) => e.name.endsWith('kfgqpc_hafs_v30.xlsx'))!.data);
    const excelJozz = sheet.slice(1).map((r) => Number(r[1]));
    const { dataset } = convert();
    const repository = new InMemoryQuranStructureRepository();
    await new ImportQuranDataset({ store: repository, unitOfWork: { run: (w) => w({} as never) }, clock: new FixedClock(new Date()) }).execute({ raw: dataset, checksum: 'a'.repeat(64), replace: false });
    const service = new QuranStructureService(repository);
    for (let g = 1; g <= 6236; g += 1) expect((await service.getAyahByGlobalPosition(g))!.juz).toBe(excelJozz[g - 1]);
    const firstOf = (j: number) => excelJozz.indexOf(j) + 1;
    expect((await service.listJuzs()).map((j) => j.start.globalPosition)).toEqual(Array.from({ length: 30 }, (_, i) => firstOf(i + 1)));
  });

  it('documents where the juz (Excel) and the quarter source differ: juz 4, 11, 20, 21 and 23 start one or more ayahs from their first quarter, both stored as stated', () => {
    const { dataset } = convert();
    const juz = dataset.juz as Array<{ juz: number; start: { surah: number; ayah: number } }>;
    const quarters = dataset.quarters as Array<{ quarter: number; start: { surah: number; ayah: number } }>;
    const differing = juz.filter((j) => JSON.stringify(quarters[8 * (j.juz - 1)]!.start) !== JSON.stringify(j.start)).map((j) => j.juz);
    expect(differing).toEqual([4, 11, 20, 21, 23]);
  });

  it('imports with the REAL checksum (SHA-256 of the dataset bytes) and states 240 quarter records, 199 printed markers and the juz relation', async () => {
    const { dataset } = convert();
    const checksum = createHash('sha256').update(serializeDataset(dataset), 'utf8').digest('hex');
    const repository = new InMemoryQuranStructureRepository();
    const importer = new ImportQuranDataset({ store: repository, unitOfWork: { run: (w) => w({} as never) }, clock: new FixedClock(new Date('2026-10-24T00:00:00Z')) });
    expect((await importer.execute({ raw: dataset, checksum, replace: false })).outcome).toBe('IMPORTED'); // the real edition profile validates it
    const info = (await new QuranStructureService(repository).getDatasetInfo())!;
    expect(info.checksum).toBe(checksum);
    expect(info.checksum).not.toMatch(/^f+$/); // never a placeholder
    expect(info.source.files[0]!.sha256).toBe(APPROVED_KFGQPC_HAFS_PACKAGES[0]!.sha256); // the archive is recorded separately from the dataset checksum
    expect(info.coverage).toEqual({ quarters: { expected: 240, imported: 240 }, printedQuarterMarkers: 199, juz: { total: 30, markerConfirmed: 16, surahStartNoMarker: 9, markerConflict: 5 } });
  });
});
