import { rangeError, type QuranRangeEngine, type QuranRangeRequest, type QuranRangeSource, type RangeDirection } from '../../../22-quran-range-engine/public';
import { revisionError } from '../../domain/errors/revision-errors';
import { REVISION_UNITS, toRevisionRange, type RevisionRange, type RevisionRangeInput, type RevisionUnit } from '../../domain/value-objects/revision-range';

export interface RevisionRangeResolverDeps {
  /** Module 22: the ONLY place a range is validated and calculated (unchanged). */
  readonly engine: Pick<QuranRangeEngine, 'calculate'>;
  /** Module 21's read-only lookup, exactly the subset Module 22 itself reads: used only to find the ayah a page or a quarter starts at. */
  readonly quran: Pick<QuranRangeSource, 'listSurahs' | 'getAyah' | 'getAyahByGlobalPosition' | 'listQuarters' | 'getPage'>;
}

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 1;
const isDirection = (v: unknown): v is RangeDirection => v === 'FORWARD' || v === 'BACKWARD';

/**
 * Turns what a Teacher entered for a REVISION range into a Module 22 request and calculates it there (Module 22 is not changed). Two forms (approved Module 28 decisions):
 *  A. START_UNIT_AMOUNT `{ unit, surah?, start, amount, direction }`: the meaning of `start` depends on the unit.
 *       AYAHS    `start` = the ayah number inside `surah` (surah is required)        -> anchor { surah, ayah: start }
 *       SURAHS   `start` = the surah number in Mushaf order (no surah field)          -> anchor { surah: start }   (the engine counts whole surahs)
 *       PAGES    `start` = the Mushaf page number (no surah field)                     -> anchor = the first ayah that BEGINS on that page (FORWARD) / the last ayah that ENDS on it (BACKWARD)
 *       QUARTERS `start` = the quarter number 1..240 (no surah field)                  -> anchor = the first ayah of that quarter (FORWARD) / its last ayah (BACKWARD)
 *  B. FROM_SURAH_TO_SURAH `{ fromSurah, toSurah }`: complete surahs, both ends included -> unit SURAHS, start = fromSurah, amount = |to - from| + 1, FORWARD when from <= to, else BACKWARD.
 * The anchor of a page or quarter is chosen so that Module 22's rule "the unit that contains the anchor is the first one counted" counts exactly the page/quarter that was asked
 * for (an ayah that starts on the previous page and runs into the requested one is therefore not the anchor; the official edition never lets an ayah cross a page).
 */
export class RevisionRangeResolver {
  constructor(private readonly deps: RevisionRangeResolverDeps) {}

  async resolve(input: unknown): Promise<RevisionRange> {
    const parsed = this.parse(input);
    const request = await this.toEngineRequest(parsed);
    return toRevisionRange(parsed, await this.deps.engine.calculate(request));
  }

  private parse(input: unknown): RevisionRangeInput {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) throw revisionError('REVISION_RANGE_REQUIRED');
    const r = input as Record<string, unknown>;
    const hasFromTo = r.fromSurah !== undefined || r.toSurah !== undefined;
    const hasStartForm = r.unit !== undefined || r.start !== undefined || r.amount !== undefined || r.direction !== undefined || r.surah !== undefined;
    if (hasFromTo === hasStartForm) throw revisionError('REVISION_RANGE_FORM_INVALID');
    if (hasFromTo) {
      if (!isInt(r.fromSurah) || !isInt(r.toSurah)) throw rangeError('QURAN_RANGE_START_INVALID');
      return { form: 'FROM_SURAH_TO_SURAH', fromSurah: r.fromSurah, toSurah: r.toSurah };
    }
    if (typeof r.unit !== 'string' || !(REVISION_UNITS as readonly string[]).includes(r.unit)) {
      throw typeof r.unit === 'string' && ['LINES'].includes(r.unit) ? revisionError('REVISION_UNIT_NOT_SUPPORTED', { allowed: REVISION_UNITS }) : rangeError('QURAN_RANGE_UNIT_INVALID', { allowed: REVISION_UNITS });
    }
    if (!isDirection(r.direction)) throw rangeError('QURAN_RANGE_DIRECTION_INVALID', { allowed: ['FORWARD', 'BACKWARD'] });
    if (!isInt(r.amount)) throw rangeError('QURAN_RANGE_AMOUNT_INVALID');
    if (!isInt(r.start)) throw rangeError('QURAN_RANGE_START_INVALID');
    const unit = r.unit as RevisionUnit;
    if (unit === 'AYAHS') {
      if (!isInt(r.surah)) throw revisionError('REVISION_SURAH_REQUIRED');
    } else if (r.surah !== undefined && r.surah !== null) {
      throw revisionError('REVISION_SURAH_NOT_ALLOWED');
    }
    return { form: 'START_UNIT_AMOUNT', unit, surah: unit === 'AYAHS' ? (r.surah as number) : null, start: r.start, amount: r.amount, direction: r.direction };
  }

  private async toEngineRequest(input: RevisionRangeInput): Promise<QuranRangeRequest> {
    const { quran } = this.deps;
    if (input.form === 'FROM_SURAH_TO_SURAH') {
      const surahs = await quran.listSurahs();
      if (input.fromSurah > surahs.length || input.toSurah > surahs.length) throw rangeError('QURAN_RANGE_START_INVALID');
      return { start: { surah: input.fromSurah }, unit: 'SURAHS', amount: Math.abs(input.toSurah - input.fromSurah) + 1, direction: input.fromSurah <= input.toSurah ? 'FORWARD' : 'BACKWARD' };
    }
    const common = { unit: input.unit, amount: input.amount, direction: input.direction } as const;
    if (input.unit === 'AYAHS') return { ...common, start: { surah: input.surah as number, ayah: input.start } };
    if (input.unit === 'SURAHS') return { ...common, start: { surah: input.start } };
    if (input.unit === 'PAGES') return { ...common, start: await this.pageAnchor(input.start, input.direction) };
    return { ...common, start: await this.quarterAnchor(input.start, input.direction) };
  }

  /** FORWARD: the first ayah that BEGINS on the page. BACKWARD: the last ayah that ENDS on it. */
  private async pageAnchor(page: number, direction: RangeDirection): Promise<{ surah: number; ayah: number }> {
    const { quran } = this.deps;
    const found = await quran.getPage(page);
    if (!found) throw rangeError('QURAN_RANGE_START_INVALID');
    const edge = direction === 'FORWARD' ? found.firstAyah : found.lastAyah;
    const ayah = await quran.getAyah(edge.surah, edge.ayah);
    if (!ayah) throw rangeError('QURAN_RANGE_START_INVALID');
    if (direction === 'FORWARD' ? ayah.firstPage >= page : ayah.lastPage <= page) return { surah: ayah.surah, ayah: ayah.ayah };
    // The edge ayah runs across the page boundary: the anchor is the neighbouring ayah that really begins (ends) on the requested page.
    const neighbour = await quran.getAyahByGlobalPosition(ayah.globalPosition + (direction === 'FORWARD' ? 1 : -1));
    if (!neighbour || (direction === 'FORWARD' ? neighbour.firstPage !== page : neighbour.lastPage !== page)) throw rangeError('QURAN_RANGE_START_INVALID');
    return { surah: neighbour.surah, ayah: neighbour.ayah };
  }

  /** FORWARD: the first ayah of the quarter. BACKWARD: its last ayah (the ayah before the next quarter starts, or the last ayah of the Quran for the last quarter). */
  private async quarterAnchor(quarter: number, direction: RangeDirection): Promise<{ surah: number; ayah: number }> {
    const { quran } = this.deps;
    const quarters = await quran.listQuarters();
    const found = quarters.find((q) => q.quarter === quarter);
    if (!found) throw rangeError('QURAN_RANGE_START_INVALID');
    if (direction === 'FORWARD') return { surah: found.start.surah, ayah: found.start.ayah };
    const next = quarters.find((q) => q.quarter === quarter + 1);
    if (next) {
      const last = await quran.getAyahByGlobalPosition(next.start.globalPosition - 1);
      if (!last) throw rangeError('QURAN_RANGE_START_INVALID');
      return { surah: last.surah, ayah: last.ayah };
    }
    const surahs = await quran.listSurahs();
    const lastSurah = surahs[surahs.length - 1];
    if (!lastSurah) throw rangeError('QURAN_RANGE_START_INVALID');
    return { surah: lastSurah.number, ayah: lastSurah.ayahCount };
  }
}
