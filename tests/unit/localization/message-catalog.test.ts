import { describe, expect, it } from 'vitest';
import { ErrorCodes } from '../../../src/modules/00-shared-kernel/public';
import {
  FOUNDATION_ERROR_MESSAGES,
  MessageCatalog,
  defaultMessageCatalog,
  interpolate,
  localize,
} from '../../../src/modules/03-error-localization/public';

describe('interpolate', () => {
  it('replaces known placeholders and keeps unknown ones visible', () => {
    expect(interpolate('Max {max} for {name}', { max: 5 })).toBe('Max 5 for {name}');
    expect(interpolate('no params')).toBe('no params');
  });
  it('does not treat inherited properties as params', () => {
    expect(interpolate('{toString}', {})).toBe('{toString}');
  });
});

describe('localize', () => {
  const text = { ar: 'مرحبا', en: 'Hello' };
  it('picks the requested locale', () => {
    expect(localize(text, 'ar')).toBe('مرحبا');
    expect(localize(text, 'en')).toBe('Hello');
  });
  it('falls back to English for unknown locales', () => {
    expect(localize(text, 'fr')).toBe('Hello');
  });
});

describe('MessageCatalog', () => {
  it('registers entries and resolves messages with params', () => {
    const c = new MessageCatalog();
    c.register([{ code: 'TOO_MANY', message: { ar: 'الحد {max}', en: 'Limit {max}' } }]);
    expect(c.message('TOO_MANY', 'ar', { max: 3 })).toBe('الحد 3');
    expect(c.message('TOO_MANY', 'en', { max: 3 })).toBe('Limit 3');
    expect(c.has('TOO_MANY')).toBe(true);
  });
  it('requires both Arabic and English', () => {
    const c = new MessageCatalog();
    expect(() => c.register([{ code: 'X', message: { ar: '', en: 'x' } }])).toThrow();
    expect(() => c.register([{ code: 'X', message: { en: 'x' } as never }])).toThrow();
  });
  it('rejects bad code format and duplicates', () => {
    const c = new MessageCatalog();
    expect(() => c.register([{ code: 'lower', message: { ar: 'أ', en: 'a' } }])).toThrow();
    c.register([{ code: 'ONE', message: { ar: 'أ', en: 'a' } }]);
    expect(() => c.register([{ code: 'ONE', message: { ar: 'ب', en: 'b' } }])).toThrow();
    expect(() =>
      c.register([
        { code: 'TWO', message: { ar: 'أ', en: 'a' } },
        { code: 'TWO', message: { ar: 'ب', en: 'b' } },
      ]),
    ).toThrow();
  });
  it('is atomic: a failed batch registers nothing', () => {
    const c = new MessageCatalog();
    try {
      c.register([
        { code: 'GOOD', message: { ar: 'أ', en: 'a' } },
        { code: 'bad', message: { ar: 'أ', en: 'a' } },
      ]);
    } catch {
      /* expected */
    }
    expect(c.has('GOOD')).toBe(false);
  });
  it('unknown codes fall back to the generic internal-error message', () => {
    expect(defaultMessageCatalog.message('NOT_REGISTERED', 'en')).toBe(
      defaultMessageCatalog.message(ErrorCodes.INTERNAL_ERROR, 'en'),
    );
  });
});

describe('foundation messages', () => {
  it('cover every foundation error code in both languages', () => {
    for (const code of Object.values(ErrorCodes)) {
      expect(defaultMessageCatalog.has(code)).toBe(true);
      expect(defaultMessageCatalog.message(code, 'ar').length > 0).toBe(true);
    }
    expect(FOUNDATION_ERROR_MESSAGES.length).toBe(Object.values(ErrorCodes).length);
  });
});
