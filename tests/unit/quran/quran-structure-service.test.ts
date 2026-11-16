import { describe, expect, it } from 'vitest';
import { createQuranHarness } from '../../helpers/quran-service-harness';

describe('QuranStructureService (the QuranStructureLookup contract)', () => {
  it('reports no dataset, and every other read fails closed with QURAN_DATASET_NOT_IMPORTED', async () => {
    const { service } = createQuranHarness();
    expect(await service.getDatasetInfo()).toBeUndefined();
    for (const call of [() => service.listSurahs(), () => service.getSurah(1), () => service.getAyah(1, 1), () => service.getAyahByGlobalPosition(1), () => service.getPage(1), () => service.getLineByGlobalIndex(1), () => service.listQuarters(), () => service.getQuarter(1), () => service.listQuarterMarks(), () => service.listJuzs(), () => service.listAyahsOfSurah(1, { page: 1, pageSize: 10 })]) {
      await expect(call()).rejects.toMatchObject({ code: 'QURAN_DATASET_NOT_IMPORTED', kind: 'NOT_FOUND' });
    }
  });

  it('exposes the attribution of the imported dataset', async () => {
    const { service, importSynthetic } = createQuranHarness();
    await importSynthetic();
    expect(await service.getDatasetInfo()).toMatchObject({
      editionCode: 'SYNTHETIC_TEST_EDITION',
      source: { provider: 'SYNTHETIC TEST DATA', files: [{ name: 'synthetic.json', sha256: 'a'.repeat(64) }] },
      checksum: 'a'.repeat(64),
      counts: { surahs: 114, ayahs: 6236, pages: 604, quarters: 240, quarterMarks: 162 },
      importedAt: '2026-10-22T10:00:00.000Z',
    });
  });

  it('states what the dataset contains: 240 quarter records, the printed markers as a separate count, and the juz relation', async () => {
    const { service, importSynthetic } = createQuranHarness();
    await importSynthetic();
    const info = (await service.getDatasetInfo())!;
    expect(info.coverage.quarters).toEqual({ expected: 240, imported: 240 });
    expect(info.coverage.printedQuarterMarkers).toBe(162); // a different thing from the quarter records: markers are evidence about the text
    const { juz } = info.coverage;
    expect(juz.total).toBe(30);
    expect(juz.markerConfirmed + juz.surahStartNoMarker + juz.markerConflict).toBe(30);
    expect((await service.listQuarters()).length).toBe(info.coverage.quarters.imported);
    expect((await service.listQuarterMarks()).length).toBe(info.coverage.printedQuarterMarkers);
  });

  it('looks surahs and ayahs up by number and by global position, consistently', async () => {
    const { service, importSynthetic } = createQuranHarness();
    await importSynthetic();
    expect(await service.listSurahs()).toHaveLength(114);
    expect(await service.getSurah(2)).toMatchObject({ number: 2, ayahCount: 286, firstGlobalPosition: 8 });
    expect(await service.getSurah(115)).toBeUndefined();
    const byNumber = await service.getAyah(2, 255);
    expect(byNumber).toMatchObject({ surah: 2, ayah: 255, globalPosition: 7 + 255 });
    expect(await service.getAyahByGlobalPosition(7 + 255)).toEqual(byNumber);
    expect(await service.getAyah(1, 8)).toBeUndefined();
    expect(await service.getAyahByGlobalPosition(6237)).toBeUndefined();
    expect((await service.getAyahByGlobalPosition(6236))!).toMatchObject({ surah: 114, ayah: 6, lastPage: 604, juz: 30, quarter: 240, hizb: 60 });
  });

  it('keeps global ordering: positions run 1..6236 with surah then ayah order', async () => {
    const { service, importSynthetic } = createQuranHarness();
    await importSynthetic();
    let previous: { surah: number; ayah: number } | undefined;
    for (const position of [1, 7, 8, 293, 294, 6235, 6236]) {
      const a = (await service.getAyahByGlobalPosition(position))!;
      expect(a.globalPosition).toBe(position);
      if (previous) expect(a.surah > previous.surah || (a.surah === previous.surah && a.ayah > previous.ayah)).toBe(true);
      previous = a;
    }
  });

  it('pages the ayahs of a surah, ascending and descending', async () => {
    const { service, importSynthetic } = createQuranHarness();
    await importSynthetic();
    const first = await service.listAyahsOfSurah(2, { page: 1, pageSize: 100 });
    expect(first.items.map((a) => a.ayah)).toEqual(Array.from({ length: 100 }, (_, i) => i + 1));
    expect(first).toMatchObject({ total: 286, totalPages: 3 });
    const last = await service.listAyahsOfSurah(2, { page: 3, pageSize: 100 });
    expect(last.items).toHaveLength(86);
    const desc = await service.listAyahsOfSurah(2, { page: 1, pageSize: 3 }, 'desc');
    expect(desc.items.map((a) => a.ayah)).toEqual([286, 285, 284]);
  });

  it('serves a page with its lines (banner, basmala and text) and the first and last ayah', async () => {
    const { service, importSynthetic } = createQuranHarness();
    await importSynthetic();
    const page = (await service.getPage(1))!;
    expect(page.lineCount).toBe(page.lines.length);
    expect(page.lines[0]).toMatchObject({ page: 1, line: 1, kind: 'SURAH_HEADER', surah: 1, firstAyah: null });
    expect(page.firstAyah).toEqual({ surah: 1, ayah: 1, globalPosition: 1 });
    const text = page.lines.find((l) => l.kind === 'TEXT')!;
    expect(text.firstAyah).toMatchObject({ surah: 1, ayah: 1, globalPosition: 1 });
    expect(await service.getPage(604)).toMatchObject({ page: 604 });
    expect(await service.getPage(605)).toBeUndefined();
    expect(await service.getPage(0)).toBeUndefined();
  });

  it('finds a line by its global index', async () => {
    const { service, importSynthetic } = createQuranHarness();
    await importSynthetic();
    expect(await service.getLineByGlobalIndex(1)).toMatchObject({ globalLine: 1, page: 1, line: 1, kind: 'SURAH_HEADER' });
    expect(await service.getLineByGlobalIndex(0)).toBeUndefined();
    expect(await service.getLineByGlobalIndex(10_000_000)).toBeUndefined();
  });

  it('lists the juz starts with their evidence status, and the printed quarter markers', async () => {
    const { service, importSynthetic } = createQuranHarness();
    await importSynthetic();
    const juzs = await service.listJuzs();
    const marks = await service.listQuarterMarks();
    expect(juzs).toHaveLength(30);
    expect(marks).toHaveLength(162);
    expect(juzs[0]).toMatchObject({ juz: 1, verification: 'SURAH_START_NO_MARKER', start: { surah: 1, ayah: 1, globalPosition: 1 } });
    expect(juzs.map((j) => j.verification)).toContain('MARKER_CONFLICT');
    expect(marks[0]).toMatchObject({ mark: 1 });
    expect(marks.map((m) => m.mark)).toEqual(marks.map((_, i) => i + 1));
    const marked = await service.getAyahByGlobalPosition(marks[0]!.start.globalPosition);
    expect(marked).toMatchObject({ startsRubMarker: true });
    expect(marked!.text.startsWith('۞ ')).toBe(true);
  });

  it('lists the 240 quarters in order with their hizb and retrieves one by number', async () => {
    const { service, importSynthetic } = createQuranHarness();
    await importSynthetic();
    const quarters = await service.listQuarters();
    expect(quarters).toHaveLength(240);
    quarters.forEach((q, i) => expect([q.quarter, q.hizb]).toEqual([i + 1, Math.ceil((i + 1) / 4)]));
    expect(quarters[0]).toMatchObject({ quarter: 1, hizb: 1, start: { surah: 1, ayah: 1, globalPosition: 1 } });
    expect(await service.getQuarter(77)).toEqual(quarters[76]);
    expect(await service.getQuarter(0)).toBeUndefined();
    expect(await service.getQuarter(241)).toBeUndefined();
    const ayah = (await service.getAyahByGlobalPosition(quarters[100]!.start.globalPosition))!;
    expect([ayah.quarter, ayah.hizb]).toEqual([101, 26]); // the quarter of an ayah is the quarter that starts at or before it
  });

  it('serves the official ayah text verbatim', async () => {
    const { service, importSynthetic } = createQuranHarness();
    await importSynthetic();
    expect((await service.getAyah(1, 1))!.text).toBe('بِسۡمِ ٱللَّهِ ٱلرَّحۡمَٰنِ ٱلرَّحِيمِ ۝١');
    expect((await service.getAyah(1, 7))!.startsRubMarker).toBe(false);
  });

  it('answers the question the Range Engine will ask: the ayahs, lines and page an ayah spans', async () => {
    const { service, importSynthetic } = createQuranHarness();
    await importSynthetic();
    const ayah = (await service.getAyah(1, 7))!;
    const first = (await service.getPage(ayah.firstPage))!.lines.find((l) => l.line === ayah.firstLine)!;
    expect(first.kind).toBe('TEXT');
    expect(first.firstAyah!.globalPosition).toBeLessThanOrEqual(ayah.globalPosition);
    expect(first.lastAyah!.globalPosition).toBeGreaterThanOrEqual(ayah.globalPosition);
  });
});
