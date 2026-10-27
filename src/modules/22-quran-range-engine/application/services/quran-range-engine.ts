import type { AyahDto, AyahRefDto, LineDto, PageDto, SurahDto } from '../../../21-quran-structure/public';
import { rangeError } from '../../domain/errors/range-errors';
import { parseRangeRequest, type ParsedRangeRequest, type QuranRangeRequest } from '../../domain/value-objects/range-request';
import type { QuranRangeResult, QuranRangeSegment, QuranRangeTotals } from '../dto/range-dto';
import type { QuranRangeSource } from '../ports/quran-range-source';

/** The first and last ayah (global position, 1..6236 in the canonical order) of a range, in Quran order. */
interface Span {
  readonly first: number;
  readonly last: number;
}

/**
 * THE Quran Range Engine (Master Specification §47): Start Position + Unit + Amount + Direction -> End Position + Generated Range.
 *
 * A calculation over the read-only Module 21 data. It stores nothing, keeps no state between calls, and is deterministic: the same request over
 * the same imported Quran always gives the same answer. Ranges are always WHOLE AYAHS, may cross surahs, and are reported as per-surah segments in
 * Quran order whatever the direction.
 *
 * Approved rules (docs/QURAN-RANGE-ENGINE.md):
 *  - Start. `{ surah, ayah }` anchors at that ayah. `{ surah }` (no ayah) anchors at the surah's FIRST ayah going FORWARD and its LAST ayah going BACKWARD.
 *  - FORWARD begins at the anchor ayah and moves toward the end of the Quran; BACKWARD ENDS at the anchor ayah (it is included) and moves toward the beginning.
 *  - AYAHS: the amount of ayahs, the anchor included.
 *  - SURAHS: complete surahs. The surah containing the anchor is the first one counted, in full (never a partial range from the start ayah).
 *  - QUARTERS / PAGES: the unit that contains the anchor is the first one counted (FORWARD: the quarter/page of the anchor's first line/ayah start;
 *    BACKWARD: its last). The range finishes at the end of the final counted unit in the direction of travel. A boundary that falls inside an ayah is
 *    rounded OUT to the whole ayah (an ayah that continues onto the next page is included).
 *  - LINES: only TEXT lines are counted (surah banners and basmala lines never are). FORWARD counts from the FIRST line of the anchor ayah, BACKWARD from its
 *    LAST line. The boundary is rounded out to the whole ayah touched by the last counted line (a line shared by two ayahs includes both).
 *  - Past the first or last position of the Quran the request is rejected with QURAN_RANGE_EXCEEDS_QURAN: no wrap-around and no clamping.
 */
export class QuranRangeEngine {
  constructor(private readonly source: QuranRangeSource) {}

  async calculate(input: QuranRangeRequest): Promise<QuranRangeResult> {
    const request = parseRangeRequest(input);
    const run = new Calculation(this.source, request);
    return run.execute();
  }
}

class Calculation {
  private readonly pages = new Map<number, PageDto | undefined>();
  private readonly ayahs = new Map<number, AyahDto>();
  private surahs: readonly SurahDto[] = [];

  constructor(
    private readonly source: QuranRangeSource,
    private readonly request: ParsedRangeRequest,
  ) {}

  async execute(): Promise<QuranRangeResult> {
    const { request } = this;
    this.surahs = [...(await this.source.listSurahs())].sort((a, b) => a.number - b.number);
    const anchor = await this.resolveAnchor();
    const span = await this.spanOf(anchor);
    const first = this.refOf(span.first);
    const last = this.refOf(span.last);
    return {
      request: { unit: request.unit, direction: request.direction, amount: request.amount, start: { surah: request.surah, ayah: request.ayah } },
      start: this.refOf(anchor.globalPosition),
      end: request.direction === 'FORWARD' ? last : first,
      first,
      last,
      segments: this.segmentsOf(span),
      totals: await this.totalsOf(span),
    };
  }

  // ---- start position -------------------------------------------------------------------------------------------------------------------------------

  private async resolveAnchor(): Promise<AyahDto> {
    const { surah: surahNumber, ayah, direction } = this.request;
    const surah = this.surahs.find((s) => s.number === surahNumber);
    if (!surah) throw rangeError('QURAN_RANGE_START_INVALID');
    const anchor =
      ayah !== null
        ? await this.source.getAyah(surahNumber, ayah)
        : await this.source.getAyahByGlobalPosition(direction === 'FORWARD' ? surah.firstGlobalPosition : surah.firstGlobalPosition + surah.ayahCount - 1);
    if (!anchor) throw rangeError('QURAN_RANGE_START_INVALID');
    this.ayahs.set(anchor.globalPosition, anchor);
    return anchor;
  }

  // ---- the five units -------------------------------------------------------------------------------------------------------------------------------

  private spanOf(anchor: AyahDto): Promise<Span> | Span {
    switch (this.request.unit) {
      case 'AYAHS':
        return this.ayahSpan(anchor);
      case 'SURAHS':
        return this.surahSpan();
      case 'QUARTERS':
        return this.quarterSpan(anchor);
      case 'PAGES':
        return this.pageSpan(anchor);
      case 'LINES':
        return this.lineSpan(anchor);
    }
  }

  private ayahSpan(anchor: AyahDto): Span {
    const { amount, direction } = this.request;
    if (direction === 'FORWARD') {
      const last = anchor.globalPosition + amount - 1;
      if (last > this.lastGlobal()) throw this.exceeds('END_OF_QURAN');
      return { first: anchor.globalPosition, last };
    }
    const first = anchor.globalPosition - amount + 1;
    if (first < this.firstGlobal()) throw this.exceeds('BEGINNING_OF_QURAN');
    return { first, last: anchor.globalPosition };
  }

  private surahSpan(): Span {
    const { amount, direction, surah } = this.request;
    const edge = (number: number): SurahDto | undefined => this.surahs.find((s) => s.number === number);
    if (direction === 'FORWARD') {
      const final = edge(surah + amount - 1);
      if (!final) throw this.exceeds('END_OF_QURAN');
      return { first: edge(surah)!.firstGlobalPosition, last: final.firstGlobalPosition + final.ayahCount - 1 };
    }
    const begin = edge(surah - amount + 1);
    if (!begin) throw this.exceeds('BEGINNING_OF_QURAN');
    const own = edge(surah)!;
    return { first: begin.firstGlobalPosition, last: own.firstGlobalPosition + own.ayahCount - 1 };
  }

  private async quarterSpan(anchor: AyahDto): Promise<Span> {
    const { amount, direction } = this.request;
    const starts = new Map((await this.source.listQuarters()).map((q) => [q.quarter, q.start.globalPosition] as const));
    const numbers = [...starts.keys()];
    const lowest = Math.min(...numbers);
    const highest = Math.max(...numbers);
    if (!starts.has(anchor.quarter)) throw rangeError('QURAN_RANGE_LAYOUT_INCONSISTENT');
    if (direction === 'FORWARD') {
      const finalQuarter = anchor.quarter + amount - 1;
      if (finalQuarter > highest) throw this.exceeds('END_OF_QURAN');
      // a quarter ends where the next one starts; the last quarter ends with the Quran
      const next = starts.get(finalQuarter + 1);
      return { first: anchor.globalPosition, last: next === undefined ? this.lastGlobal() : next - 1 };
    }
    const firstQuarter = anchor.quarter - amount + 1;
    if (firstQuarter < lowest) throw this.exceeds('BEGINNING_OF_QURAN');
    return { first: starts.get(firstQuarter)!, last: anchor.globalPosition };
  }

  private async pageSpan(anchor: AyahDto): Promise<Span> {
    const { amount, direction } = this.request;
    if (direction === 'FORWARD') {
      // the page where the anchor ayah begins is the first one counted; the range ends with the ayah on the last line of the final page
      const page = await this.page(anchor.firstPage + amount - 1);
      if (!page) throw this.exceeds('END_OF_QURAN');
      return { first: anchor.globalPosition, last: page.lastAyah.globalPosition };
    }
    const number = anchor.lastPage - amount + 1;
    if (number < 1) throw this.exceeds('BEGINNING_OF_QURAN');
    const page = await this.page(number);
    if (!page) throw rangeError('QURAN_RANGE_LAYOUT_INCONSISTENT');
    return { first: page.firstAyah.globalPosition, last: anchor.globalPosition };
  }

  /** TEXT lines only. The boundary is the whole ayah touched by the last counted line. */
  private async lineSpan(anchor: AyahDto): Promise<Span> {
    const { amount, direction } = this.request;
    const forward = direction === 'FORWARD';
    let pageNumber = forward ? anchor.firstPage : anchor.lastPage;
    const anchorLine = forward ? anchor.firstLine : anchor.lastLine;
    let counted = 0;
    let onAnchorPage = true;
    while (pageNumber >= 1) {
      const page = await this.page(pageNumber);
      if (!page) break;
      let lines = [...page.lines].sort((a, b) => a.line - b.line);
      if (onAnchorPage) {
        const own = lines.find((l) => l.line === anchorLine);
        if (!own || own.kind !== 'TEXT') throw rangeError('QURAN_RANGE_LAYOUT_INCONSISTENT');
        lines = lines.filter((l) => (forward ? l.line >= anchorLine : l.line <= anchorLine));
        onAnchorPage = false;
      }
      if (!forward) lines.reverse();
      for (const line of lines) {
        if (line.kind !== 'TEXT') continue;
        counted += 1;
        if (counted === amount) return this.boundaryOfLine(line, anchor);
      }
      pageNumber += forward ? 1 : -1;
    }
    throw this.exceeds(forward ? 'END_OF_QURAN' : 'BEGINNING_OF_QURAN');
  }

  private boundaryOfLine(line: LineDto, anchor: AyahDto): Span {
    const edge = this.request.direction === 'FORWARD' ? line.lastAyah : line.firstAyah;
    if (!edge) throw rangeError('QURAN_RANGE_LAYOUT_INCONSISTENT');
    const reaches = this.request.direction === 'FORWARD' ? edge.globalPosition >= anchor.globalPosition : edge.globalPosition <= anchor.globalPosition;
    if (!reaches) throw rangeError('QURAN_RANGE_LAYOUT_INCONSISTENT');
    return this.request.direction === 'FORWARD' ? { first: anchor.globalPosition, last: edge.globalPosition } : { first: edge.globalPosition, last: anchor.globalPosition };
  }

  // ---- the result -----------------------------------------------------------------------------------------------------------------------------------

  private segmentsOf(span: Span): QuranRangeSegment[] {
    const segments: QuranRangeSegment[] = [];
    for (const surah of this.surahs) {
      const surahFirst = surah.firstGlobalPosition;
      const surahLast = surahFirst + surah.ayahCount - 1;
      if (surahLast < span.first || surahFirst > span.last) continue;
      const from = Math.max(span.first, surahFirst);
      const to = Math.min(span.last, surahLast);
      segments.push({ surah: surah.number, firstAyah: from - surahFirst + 1, lastAyah: to - surahFirst + 1, ayahCount: to - from + 1, complete: from === surahFirst && to === surahLast });
    }
    return segments;
  }

  private async totalsOf(span: Span): Promise<QuranRangeTotals> {
    const first = await this.ayah(span.first);
    const last = await this.ayah(span.last);
    let textLines = 0;
    for (let number = first.firstPage; number <= last.lastPage; number += 1) {
      const page = await this.page(number);
      if (!page) throw rangeError('QURAN_RANGE_LAYOUT_INCONSISTENT');
      textLines += page.lines.filter((l) => l.kind === 'TEXT' && l.firstAyah !== null && l.lastAyah !== null && l.firstAyah.globalPosition <= span.last && l.lastAyah.globalPosition >= span.first).length;
    }
    return { ayahs: span.last - span.first + 1, surahs: this.segmentsOf(span).length, pages: last.lastPage - first.firstPage + 1, textLines };
  }

  // ---- helpers --------------------------------------------------------------------------------------------------------------------------------------

  private firstGlobal(): number {
    return this.surahs[0]!.firstGlobalPosition;
  }

  private lastGlobal(): number {
    const last = this.surahs[this.surahs.length - 1]!;
    return last.firstGlobalPosition + last.ayahCount - 1;
  }

  private refOf(global: number): AyahRefDto {
    const surah = this.surahs.find((s) => s.firstGlobalPosition <= global && global < s.firstGlobalPosition + s.ayahCount);
    if (!surah) throw rangeError('QURAN_RANGE_LAYOUT_INCONSISTENT');
    return { surah: surah.number, ayah: global - surah.firstGlobalPosition + 1, globalPosition: global };
  }

  private async ayah(global: number): Promise<AyahDto> {
    const known = this.ayahs.get(global);
    if (known) return known;
    const found = await this.source.getAyahByGlobalPosition(global);
    if (!found) throw rangeError('QURAN_RANGE_LAYOUT_INCONSISTENT');
    this.ayahs.set(global, found);
    return found;
  }

  private async page(number: number): Promise<PageDto | undefined> {
    if (!this.pages.has(number)) this.pages.set(number, await this.source.getPage(number));
    return this.pages.get(number);
  }

  private exceeds(boundary: 'END_OF_QURAN' | 'BEGINNING_OF_QURAN') {
    const { unit, direction, amount } = this.request;
    return rangeError('QURAN_RANGE_EXCEEDS_QURAN', { unit, direction, amount, boundary });
  }
}
