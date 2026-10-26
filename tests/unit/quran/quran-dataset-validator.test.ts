import { describe, expect, it } from 'vitest';
import { MAX_REPORTED_PROBLEMS, QuranDatasetValidationError, ayahPositionOf, validateQuranDataset } from '../../../src/modules/21-quran-structure/public';
import { SYNTHETIC_PROFILE, buildSyntheticDataset, syntheticAyahText, syntheticIsMarked, syntheticJuzStart, syntheticQuarterStart } from '../../helpers/quran-fixture';

type Json = Record<string, any>;
const validate = (raw: unknown) => validateQuranDataset(raw, SYNTHETIC_PROFILE);
const problemsOf = (raw: unknown): string[] => {
  try {
    validate(raw);
  } catch (error) {
    if (error instanceof QuranDatasetValidationError) return [...error.problems];
    throw error;
  }
  return [];
};
const mutated = (change: (d: Json) => void): Json => {
  const d = buildSyntheticDataset() as Json;
  change(d);
  return d;
};
const hasProblem = (raw: unknown, fragment: string) => expect(problemsOf(raw).join('\n')).toContain(fragment);

describe('validateQuranDataset: a valid dataset', () => {
  const dataset = validate(buildSyntheticDataset());

  it('derives every structure of the edition', () => {
    expect(dataset.surahs).toHaveLength(114);
    expect(dataset.ayahs).toHaveLength(6236);
    expect(dataset.pages).toHaveLength(604);
    expect(dataset.juzs).toHaveLength(30);
    expect(dataset.quarters).toHaveLength(240);
    expect(dataset.surahs[1]).toMatchObject({ number: 2, ayahCount: 286, firstGlobalAyah: 8 });
  });

  it('orders ayahs globally, keeps the verbatim text and gives each a first and last page/line and a juz', () => {
    dataset.ayahs.forEach((a, i) => {
      expect(a.globalAyah).toBe(i + 1);
      expect(a.text).toBe(syntheticAyahText(a.surah, a.ayah));
      expect(a.firstPage).toBeGreaterThanOrEqual(1);
      expect(a.lastPage).toBeGreaterThanOrEqual(a.firstPage);
      expect(a.startsRubMarker).toBe(syntheticIsMarked(a.globalAyah));
    });
    expect(dataset.ayahs[0]).toMatchObject({ surah: 1, ayah: 1, firstPage: 1, juz: 1 });
    expect(dataset.ayahs[6235]).toMatchObject({ surah: 114, ayah: 6, lastPage: 604, juz: 30 });
    expect(dataset.ayahs.filter((a) => a.firstPage !== a.lastPage)).toHaveLength(0);
  });

  it('numbers lines globally in page/line order and keeps banner and basmala lines', () => {
    dataset.lines.forEach((l, i) => expect(l.globalLine).toBe(i + 1));
    expect(dataset.lines.filter((l) => l.kind === 'SURAH_HEADER')).toHaveLength(114);
    expect(dataset.lines.filter((l) => l.kind === 'BASMALA')).toHaveLength(112); // none for surahs 1 and 9
    expect(dataset.pages.every((p) => p.lineCount >= 1)).toBe(true);
  });

  it('derives the juz of every ayah from the juz starts, and records how each start relates to the printed markers', () => {
    dataset.juzs.forEach((j, k) => expect([j.juz, j.startGlobalAyah]).toEqual([k + 1, syntheticJuzStart(k + 1)]));
    for (const a of dataset.ayahs) expect(a.juz).toBe(dataset.juzs.filter((j) => j.startGlobalAyah <= a.globalAyah).length);
    const byStatus = (status: string) => dataset.juzs.filter((j) => j.verification === status).map((j) => j.juz);
    expect(byStatus('SURAH_START_NO_MARKER')).toEqual([1]); // 1:1: a surah start, never marked
    const confirmed = Array.from({ length: 30 }, (_, k) => k + 1).filter((j) => j > 1 && syntheticIsMarked(syntheticJuzStart(j)));
    expect(confirmed.length).toBeGreaterThanOrEqual(10);
    expect(byStatus('MARKER_CONFIRMED')).toEqual(confirmed);
    expect(byStatus('MARKER_CONFLICT')).toHaveLength(29 - confirmed.length); // mid-surah starts without a marker: UNRESOLVED, reported, never repaired
    for (const j of dataset.juzs.filter((x) => x.verification === 'MARKER_CONFLICT')) expect(j.startAyah).toBeGreaterThan(1);
  });

  it('keeps all 240 quarter records exactly as stated, gives each ayah its quarter and hizb, and does not reconcile them with the juz', () => {
    dataset.quarters.forEach((q, i) => expect([q.quarter, q.hizb, q.startGlobalAyah]).toEqual([i + 1, Math.ceil((i + 1) / 4), syntheticQuarterStart(i + 1)]));
    for (const a of dataset.ayahs) expect(a.quarter).toBe(dataset.quarters.filter((q) => q.startGlobalAyah <= a.globalAyah).length);
    expect(dataset.ayahs[0]!.quarter).toBe(1);
    expect(dataset.ayahs[6235]!.quarter).toBe(240);
  });

  it('does not reconcile the juz (Excel) with the quarters (quarter source): where they differ, both are kept exactly as stated', () => {
    const g = syntheticQuarterStart(25) + 1; // quarter 25 one ayah after juz 4's start, like the real sources
    const p = ayahPositionOf(g)!;
    const v = validate(mutated((d) => (d.quarters[24].start = { surah: p.surah, ayah: p.ayah })));
    expect(v.juzs[3]!.startGlobalAyah).toBe(syntheticJuzStart(4));
    expect(v.quarters[24]!.startGlobalAyah).toBe(g);
    expect(v.juzs[3]!.startGlobalAyah).not.toBe(v.quarters[24]!.startGlobalAyah);
  });

  it('keeps exactly the printed quarter markers (the ayahs whose text starts with the marker), numbered by ordinal only', () => {
    const marked = dataset.ayahs.filter((a) => a.text.startsWith('۞ '));
    expect(dataset.quarterMarks).toHaveLength(marked.length);
    expect(dataset.quarterMarks.map((m) => m.startGlobalAyah)).toEqual(marked.map((a) => a.globalAyah));
    dataset.quarterMarks.forEach((m, i) => expect(m.mark).toBe(i + 1));
  });

  it('records the source attribution and files', () => {
    expect(dataset.source).toMatchObject({ provider: 'SYNTHETIC TEST DATA', retrievedOn: '2026-10-22', files: [{ name: 'synthetic.json', sha256: 'a'.repeat(64) }] });
  });
});

describe('validateQuranDataset: rejects an incomplete, inconsistent or foreign dataset (nothing is guessed or repaired)', () => {
  it('rejects the synthetic shape against the REAL edition anchors (it is not the Madinah Mushaf)', () => {
    expect(() => validateQuranDataset(buildSyntheticDataset())).toThrow(QuranDatasetValidationError);
  });

  it('rejects anything that is not the dataset object, the format, or the edition', () => {
    expect(() => validate(null)).toThrow(QuranDatasetValidationError);
    expect(() => validate([])).toThrow(QuranDatasetValidationError);
    hasProblem(mutated((d) => (d.format = 'other')), '"format"');
    hasProblem(mutated((d) => (d.formatVersion = 4)), '"formatVersion"');
    hasProblem(mutated((d) => (d.edition.narration = 'WARSH')), 'only the approved edition is accepted');
    hasProblem(mutated((d) => (d.edition.pages = 600)), 'only the approved edition is accepted');
    hasProblem(mutated((d) => (d.edition.mushaf = 'OTHER')), 'only the approved edition is accepted');
  });

  it('requires the source attribution', () => {
    hasProblem(mutated((d) => delete d.source), '"source"');
    hasProblem(mutated((d) => (d.source.provider = '  ')), 'source.provider');
    hasProblem(mutated((d) => (d.source.name = undefined)), 'source.name');
    hasProblem(mutated((d) => (d.source.retrievedOn = '22/10/2026')), 'source.retrievedOn');
  });

  it('rejects wrong surahs: count, order, ayah counts, missing name', () => {
    hasProblem(mutated((d) => d.surahs.pop()), 'exactly 114 surahs');
    hasProblem(mutated((d) => ([d.surahs[3], d.surahs[4]] = [d.surahs[4], d.surahs[3]])), 'surahs[3].number must be 4');
    hasProblem(mutated((d) => (d.surahs[1].ayahCount = 285)), 'ayahCount must be 286');
    hasProblem(mutated((d) => (d.surahs[0].nameAr = '')), 'surahs[0].nameAr');
  });

  it('rejects a missing, repeated or swapped line (continuity of the ayah order)', () => {
    expect(problemsOf(mutated((d) => d.lines.splice(100, 1))).length).toBeGreaterThan(0);
    expect(problemsOf(mutated((d) => d.lines.splice(100, 0, d.lines[100]))).length).toBeGreaterThan(0);
    expect(problemsOf(mutated((d) => ([d.lines[300], d.lines[301]] = [d.lines[301], d.lines[300]]))).length).toBeGreaterThan(0);
  });

  it('rejects an ayah that jumps ahead, and a layout that does not end at the last ayah', () => {
    const jump = mutated((d) => {
      const i = d.lines.findIndex((l: Json) => l.kind === 'TEXT' && l.firstAyah.surah === 3 && l.firstAyah.ayah === 10);
      d.lines[i].firstAyah = { surah: 3, ayah: 12 };
      d.lines[i].lastAyah = { surah: 3, ayah: 12 };
    });
    hasProblem(jump, 'the ayah order breaks');
    hasProblem(mutated((d) => { for (let i = d.lines.length - 1; d.lines[i].page === 604 && i > 0; i -= 1) if (d.lines[i].kind === 'TEXT') { d.lines[i].lastAyah = { surah: 114, ayah: 5 }; break; } }), 'must end with the last ayah');
  });

  it('rejects page numbering gaps and a wrong page count', () => {
    hasProblem(mutated((d) => (d.lines = d.lines.filter((l: Json) => l.page !== 10))), 'was expected');
    hasProblem(mutated((d) => (d.lines = d.lines.filter((l: Json) => l.page !== 604))), 'exactly 604 pages');
    hasProblem(mutated((d) => (d.lines[5].line = 99)), 'was expected');
  });

  it('rejects malformed lines: unknown kind, ayah on a banner, no ayah on a text line, ayah outside the Hafs count', () => {
    hasProblem(mutated((d) => (d.lines[0].kind = 'FOOTER')), 'needs an integer');
    hasProblem(mutated((d) => (d.lines[0].firstAyah = { surah: 1, ayah: 1 })), 'carries no ayahs');
    hasProblem(mutated((d) => { const i = d.lines.findIndex((l: Json) => l.kind === 'TEXT'); delete d.lines[i].lastAyah; }), 'lastAyah must be');
    hasProblem(mutated((d) => { const i = d.lines.findIndex((l: Json) => l.kind === 'TEXT'); d.lines[i].lastAyah = { surah: 1, ayah: 8 }; }), 'is not an ayah of the Hafs count');
  });

  it('rejects wrong banner and basmala placement', () => {
    hasProblem(mutated((d) => (d.lines = d.lines.filter((l: Json) => !(l.kind === 'SURAH_HEADER' && l.surah === 5)))), 'banner');
    const replaceNextLine = (d: Json, afterKind: string, surah: number) => {
      const i = d.lines.findIndex((l: Json) => l.kind === afterKind && l.surah === surah);
      const { page, line } = d.lines[i + 1];
      d.lines[i + 1] = { page, line, kind: 'BASMALA', surah };
    };
    hasProblem(mutated((d) => replaceNextLine(d, 'SURAH_HEADER', 9)), 'has no separate basmala line');
    hasProblem(mutated((d) => replaceNextLine(d, 'BASMALA', 3)), 'basmala line must directly follow');
  });

  it('rejects a text line that crosses a surah boundary', () => {
    hasProblem(mutated((d) => { const i = d.lines.findIndex((l: Json) => l.kind === 'TEXT' && l.firstAyah.surah === 1 && l.firstAyah.ayah === 7); d.lines[i].lastAyah = { surah: 2, ayah: 1 }; }), 'cannot cross a surah boundary');
  });

  it('rejects an older format version, missing or incomplete text, and malformed text', () => {
    hasProblem(mutated((d) => (d.formatVersion = 2)), '"formatVersion" must be 3');
    hasProblem(mutated((d) => delete d.ayahs), '"ayahs" (the official text) is required');
    hasProblem(mutated((d) => d.ayahs.pop()), 'all 6236 ayahs');
    hasProblem(mutated((d) => (d.ayahs[10].text = '')), 'ayahs[10].text must be the official text');
    hasProblem(mutated((d) => (d.ayahs[10].text = ` ${d.ayahs[10].text}`)), 'ayahs[10].text must be the official text');
    hasProblem(mutated((d) => (d.ayahs[10].text = `${d.ayahs[10].text}\u0007`)), 'without control characters');
    hasProblem(mutated((d) => ([d.ayahs[3], d.ayahs[4]] = [d.ayahs[4], d.ayahs[3]])), 'canonical order');
  });

  it('checks the end-of-ayah mark and number of every text', () => {
    hasProblem(mutated((d) => (d.ayahs[20].text = 'كلمة بلا علامة')), 'must end with the end-of-ayah mark and the ayah number');
    hasProblem(mutated((d) => (d.ayahs[20].text = d.ayahs[20].text.replace(/[٠-٩]+$/, '٩٩٩'))), 'must end with the end-of-ayah mark and the ayah number');
  });

  it('allows the quarter marker only as the first character, once', () => {
    hasProblem(mutated((d) => (d.ayahs[20].text = `كلمة ۞ ${d.ayahs[20].text}`)), 'somewhere other than its beginning');
    hasProblem(mutated((d) => (d.ayahs[20].text = `۞${d.ayahs[20].text}`)), 'somewhere other than its beginning');
  });

  it('requires quarterMarks to equal exactly the ayahs whose text starts with the marker', () => {
    hasProblem(mutated((d) => d.quarterMarks.pop()), 'starts with the printed quarter marker but is not in "quarterMarks"');
    hasProblem(mutated((d) => d.quarterMarks.push({ start: { surah: 114, ayah: 6 } })), 'carries no quarter marker');
    hasProblem(mutated((d) => delete d.quarterMarks), '"quarterMarks" must list');
    hasProblem(mutated((d) => (d.quarterMarks = [])), '"quarterMarks" must list');
    hasProblem(mutated((d) => ([d.quarterMarks[1], d.quarterMarks[2]] = [d.quarterMarks[2], d.quarterMarks[1]])), 'must come after the previous marker');
    hasProblem(mutated((d) => (d.quarterMarks = Array.from({ length: 241 }, () => d.quarterMarks[0]))), '1 to 240');
  });

  it('rejects wrong juz: count, order, numbering, first start', () => {
    hasProblem(mutated((d) => d.juz.pop()), 'exactly 30 juz starts');
    hasProblem(mutated((d) => delete d.juz), 'exactly 30 juz starts');
    hasProblem(mutated((d) => (d.juz[4].juz = 9)), 'juz[4].juz must be 5');
    hasProblem(mutated((d) => (d.juz[10].start = d.juz[9].start)), 'must come after the start of the previous juz');
    hasProblem(mutated((d) => (d.juz[0].start = { surah: 1, ayah: 2 })), 'Juz 1 must start at 1:1');
    hasProblem(mutated((d) => (d.juz[5].start = { surah: 1, ayah: 8 })), 'is not an ayah of the Hafs count');
  });

  it('rejects wrong quarter records: missing, extra, misnumbered, duplicated, out of order, not an ayah, not starting at 1:1', () => {
    hasProblem(mutated((d) => delete d.quarters), '"quarters" must list exactly 240');
    hasProblem(mutated((d) => d.quarters.pop()), 'exactly 240 quarter records');
    hasProblem(mutated((d) => d.quarters.push({ quarter: 241, start: { surah: 114, ayah: 6 } })), 'exactly 240 quarter records');
    hasProblem(mutated((d) => (d.quarters[10].quarter = 12)), 'quarters[10].quarter must be 11');
    hasProblem(mutated((d) => (d.quarters[10] = { ...d.quarters[9], quarter: 11 })), 'must come after the start of the previous quarter');
    hasProblem(mutated((d) => ([d.quarters[20], d.quarters[21]] = [{ quarter: 21, start: d.quarters[21].start }, { quarter: 22, start: d.quarters[20].start }])), 'must come after the start of the previous quarter');
    hasProblem(mutated((d) => (d.quarters[30].start = { surah: 2, ayah: 9999 })), 'is not an ayah of the Hafs count');
    hasProblem(mutated((d) => (d.quarters[0].start = { surah: 1, ayah: 2 })), 'Quarter 1 must start at 1:1');
  });

  it('rejects malformed source files and attributions', () => {
    hasProblem(mutated((d) => (d.source.attributions = [{ role: 'x' }])), 'source.attributions[0] needs');
    hasProblem(mutated((d) => (d.source.attributions = 'nope')), 'source.attributions must be a list');
    hasProblem(mutated((d) => (d.source.files = [{ name: 'x', sha256: 'XYZ' }])), 'source.files[0]');
    hasProblem(mutated((d) => (d.source.files = 'nope')), 'source.files must be a list');
  });

  it('enforces the page anchors of the edition and reports them', () => {
    const anchors = { ...SYNTHETIC_PROFILE, anchors: { ayahFirstPage: [{ surah: 2, ayah: 1, page: 604 }] } };
    const problems = (() => { try { validateQuranDataset(buildSyntheticDataset(), anchors); return []; } catch (e) { return (e as QuranDatasetValidationError).problems; } })();
    expect(problems.join('\n')).toContain('Anchor: ayah 2:1 starts on page 604');
  });

  it('reports every problem found (capped) with the real total', () => {
    const wrecked = mutated((d) => { d.lines = d.lines.filter((_: Json, i: number) => i % 3 !== 0); });
    try {
      validate(wrecked);
      expect.unreachable();
    } catch (error) {
      const e = error as QuranDatasetValidationError;
      expect(e.problems.length).toBeLessThanOrEqual(MAX_REPORTED_PROBLEMS);
      expect(e.totalProblems).toBeGreaterThanOrEqual(e.problems.length);
    }
  });
});
