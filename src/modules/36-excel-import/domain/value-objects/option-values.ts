import { foldWord, toLatinDigits } from './cell-text';

export type ImportLearningMode = 'GROUP' | 'INDIVIDUAL';
export type ImportProgression = 'FORWARD' | 'BACKWARD';

const index = (entries: Readonly<Record<string, readonly string[]>>): ReadonlyMap<string, string> => {
  const map = new Map<string, string>();
  for (const [code, words] of Object.entries(entries)) for (const w of [code, ...words]) map.set(foldWord(w), code);
  return map;
};

const LEARNING_MODES = index({ GROUP: ['جماعي', 'جماعية', 'مجموعة'], INDIVIDUAL: ['فردي', 'فردية'] });
const PROGRESSIONS = index({ FORWARD: ['للأمام', 'إلى الأمام', 'الى الامام', 'أمام'], BACKWARD: ['للخلف', 'إلى الخلف', 'الى الخلف', 'خلف'] });

/** English codes, English words and the Arabic words of the template are accepted. Anything else is undefined (a row error, never a guess). */
export const parseLearningMode = (text: string): ImportLearningMode | undefined => LEARNING_MODES.get(foldWord(text)) as ImportLearningMode | undefined;
export const parseProgression = (text: string): ImportProgression | undefined => PROGRESSIONS.get(foldWord(text)) as ImportProgression | undefined;

/** A whole number from 1 to 114 (Arabic-Indic digits accepted, a trailing `.0` from Excel tolerated). Anything else is undefined. */
export function parseStartingSurah(text: string): number | undefined {
  const t = toLatinDigits(text).trim();
  if (!/^\d{1,3}(\.0+)?$/u.test(t)) return undefined;
  const n = Number(t);
  return Number.isInteger(n) && n >= 1 && n <= 114 ? n : undefined;
}
