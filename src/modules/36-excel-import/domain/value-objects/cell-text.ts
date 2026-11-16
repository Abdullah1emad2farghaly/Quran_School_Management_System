/**
 * Cell text normalization shared by the whole import pipeline (Master Specification §74 "Normalize").
 * The workbook reader reduces every cell to a primitive; everything below works on that primitive, never on a library type.
 */
export type RawCell = string | number | boolean | null;

const ARABIC_INDIC = '٠١٢٣٤٥٦٧٨٩';
const EXTENDED_ARABIC_INDIC = '۰۱۲۳۴۵۶۷۸۹';
// Zero-width and bidirectional control characters that Excel and mobile keyboards often leave inside Arabic text.
const INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/gu;

/** Converts Arabic-Indic and Extended Arabic-Indic digits to 0-9. Everything else is unchanged. */
export function toLatinDigits(text: string): string {
  let out = '';
  for (const ch of text) {
    const a = ARABIC_INDIC.indexOf(ch);
    const e = EXTENDED_ARABIC_INDIC.indexOf(ch);
    out += a >= 0 ? String(a) : e >= 0 ? String(e) : ch;
  }
  return out;
}

/** A cell as trimmed text: NFC, invisible marks removed, whitespace collapsed. A number keeps its integer form (`3.0` -> `3`). Empty -> ''. */
export function cellText(value: RawCell | undefined): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  return value.normalize('NFC').replace(INVISIBLE, '').replace(/\s+/gu, ' ').trim();
}

/** Text used for matching words (headers, weekday names, option values): lower case, no diacritics/tatweel/invisible marks, light Arabic letter folding. */
export function foldWord(text: string): string {
  return text
    .normalize('NFKC')
    .replace(INVISIBLE, '')
    .replace(/[\u064B-\u065F\u0670\u0640]/gu, '')
    .replace(/[أإآٱ]/gu, 'ا')
    .replace(/ى/gu, 'ي')
    .replace(/ة/gu, 'ه')
    .replace(/[*:]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .toLowerCase();
}
