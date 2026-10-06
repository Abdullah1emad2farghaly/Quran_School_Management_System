import { FALLBACK_LOCALE, isLocale, type Locale } from '../../../01-configuration/public';

/** Text that exists in every supported locale (Arabic AND English are mandatory). */
export type LocalizedText = Readonly<Record<Locale, string>>;

/** Picks the text for a locale; unknown/empty falls back to the fallback locale (en). */
export function localize(text: LocalizedText, locale: string): string {
  const requested = isLocale(locale) ? text[locale] : undefined;
  return requested && requested.trim() !== '' ? requested : text[FALLBACK_LOCALE];
}
