import { FALLBACK_LOCALE, SUPPORTED_LOCALES, isLocale, type Locale } from '../../../01-configuration/public';

interface WeightedLanguage {
  readonly lang: string;
  readonly q: number;
}

/** Base languages from an Accept-Language header, best first. q=0 and "*" are ignored. */
export function parseAcceptLanguage(header: string | undefined): string[] {
  if (!header) return [];
  const parsed: Array<WeightedLanguage & { index: number }> = [];
  header.split(',').forEach((part, index) => {
    const [rawTag = '', ...params] = part.split(';');
    const tag = rawTag.trim().toLowerCase();
    if (!tag || tag === '*') return;
    let q = 1;
    for (const p of params) {
      const m = /^\s*q\s*=\s*([0-9.]+)\s*$/i.exec(p);
      if (m) q = Number(m[1]);
    }
    if (!(q > 0 && q <= 1)) return;
    const lang = tag.split('-')[0];
    if (lang) parsed.push({ lang, q, index });
  });
  parsed.sort((a, b) => b.q - a.q || a.index - b.index);
  return [...new Set(parsed.map((p) => p.lang))];
}

export interface ResolveLocaleInput {
  /** Explicit user preference (available once identity modules exist). */
  readonly userPreference?: string | null;
  readonly acceptLanguage?: string;
  /** System default from configuration (ar). */
  readonly defaultLocale: string;
}

/**
 * Priority: explicit user preference > Accept-Language > system default.
 * Never returns an unsupported locale.
 */
export function resolveLocale(input: ResolveLocaleInput): Locale {
  if (isLocale(input.userPreference)) return input.userPreference;
  for (const lang of parseAcceptLanguage(input.acceptLanguage)) {
    if ((SUPPORTED_LOCALES as readonly string[]).includes(lang)) return lang as Locale;
  }
  return isLocale(input.defaultLocale) ? input.defaultLocale : FALLBACK_LOCALE;
}
