/**
 * Language-neutral formatting of values placed into notification parameters. A parameter is the SAME text for every recipient (the template carries the language),
 * so times are written as `YYYY-MM-DD HH:mm` in the business zone (Africa/Cairo, Master Specification §71) and a Quran range as `surah:ayah`.
 */
const BUSINESS_TIME_ZONE = 'Africa/Cairo';
const NONE = '—';

export const NO_VALUE = NONE;

const cairoFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: BUSINESS_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** `2026-11-10 17:30` in Africa/Cairo. A missing or invalid instant is written as an em dash. */
export function formatCairoDateTime(value: Date | string | null | undefined): string {
  if (value === null || value === undefined) return NONE;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return NONE;
  const parts = new Map<string, string>();
  for (const p of cairoFormat.formatToParts(date)) parts.set(p.type, p.value);
  return `${parts.get('year')}-${parts.get('month')}-${parts.get('day')} ${parts.get('hour')}:${parts.get('minute')}`;
}

/** Scores are kept to two decimal places (consistent with Modules 29 and 30); work in hundredths so no floating-point noise reaches a message. */
const toHundredths = (n: number): number => Math.round(n * 100);

/** The score as a short text (no trailing zeros): 9, 8.5, 7.25. */
export const formatScore = (n: number): string => String(Number((toHundredths(n) / 100).toFixed(2)));

/** The exact sum of the scores (hundredths arithmetic). */
export function sumScores(scores: readonly number[]): number {
  return scores.reduce((acc, n) => acc + toHundredths(n), 0) / 100;
}

export interface AyahPoint {
  readonly surah: number;
  readonly ayah: number;
}

/** `2:5 → 2:10`. Numbers only, so it reads the same in Arabic and English. */
export function formatAyahRange(first: AyahPoint, last: AyahPoint): string {
  return `${first.surah}:${first.ayah} → ${last.surah}:${last.ayah}`;
}

/** A free text value for a parameter (a rejection reason, a Teacher note): trimmed, never blank, cut to `max` characters. */
export function cleanText(value: string | null | undefined, max: number): string {
  const text = (value ?? '').trim();
  if (text === '') return NONE;
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/** Parses an instant carried by an event payload (an ISO string); undefined when it is missing or invalid. */
export function parseInstant(value: unknown): Date | undefined {
  if (typeof value !== 'string' && !(value instanceof Date)) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}
