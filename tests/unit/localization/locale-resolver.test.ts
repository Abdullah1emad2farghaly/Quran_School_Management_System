import { describe, expect, it } from 'vitest';
import { parseAcceptLanguage, resolveLocale } from '../../../src/modules/03-error-localization/public';

describe('parseAcceptLanguage', () => {
  it('orders by quality and keeps header order for ties', () => {
    expect(parseAcceptLanguage('fr;q=0.5, en;q=0.9, ar')).toEqual(['ar', 'en', 'fr']);
  });
  it('reduces regions to base language and removes duplicates', () => {
    expect(parseAcceptLanguage('ar-EG, ar-SA;q=0.8, en-US;q=0.5')).toEqual(['ar', 'en']);
  });
  it('tolerates spaces around q', () => {
    expect(parseAcceptLanguage('en; q = 0.8, ar;q=0.9')).toEqual(['ar', 'en']);
  });
  it('ignores wildcard, q=0 and garbage', () => {
    expect(parseAcceptLanguage('*, en;q=0, fr;q=abc')).toEqual(['fr']);
    expect(parseAcceptLanguage(undefined)).toEqual([]);
    expect(parseAcceptLanguage('')).toEqual([]);
  });
});

describe('resolveLocale', () => {
  it('uses the system default when nothing matches', () => {
    expect(resolveLocale({ defaultLocale: 'ar' })).toBe('ar');
    expect(resolveLocale({ acceptLanguage: 'fr-FR', defaultLocale: 'ar' })).toBe('ar');
    expect(resolveLocale({ acceptLanguage: '*', defaultLocale: 'en' })).toBe('en');
  });
  it('honors Accept-Language with quality values', () => {
    expect(resolveLocale({ acceptLanguage: 'fr;q=0.9, en;q=0.8', defaultLocale: 'ar' })).toBe('en');
    expect(resolveLocale({ acceptLanguage: 'en;q=0.5, ar;q=0.9', defaultLocale: 'en' })).toBe('ar');
  });
  it('explicit user preference wins over Accept-Language', () => {
    expect(resolveLocale({ userPreference: 'en', acceptLanguage: 'ar', defaultLocale: 'ar' })).toBe('en');
  });
  it('ignores an invalid user preference', () => {
    expect(resolveLocale({ userPreference: 'xx', acceptLanguage: 'en', defaultLocale: 'ar' })).toBe('en');
    expect(resolveLocale({ userPreference: null, defaultLocale: 'ar' })).toBe('ar');
  });
  it('never returns an unsupported locale even with a bad default', () => {
    expect(resolveLocale({ defaultLocale: 'zz' })).toBe('en');
  });
});
