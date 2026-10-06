import { describe, expect, it } from 'vitest';
import { AppError, ErrorCodes } from '../../../src/modules/00-shared-kernel/public';
import { MessageCatalog, normalizeError, toErrorResponse } from '../../../src/modules/03-error-localization/public';

const catalog = new MessageCatalog();
catalog.register([
  { code: ErrorCodes.INTERNAL_ERROR, message: { ar: 'خطأ داخلي', en: 'Internal error' } },
  { code: 'LIMIT_REACHED', message: { ar: 'تم بلوغ الحد {max}', en: 'Limit {max} reached' } },
]);

describe('toErrorResponse', () => {
  it('builds the standard shape with a stable code and localized message', () => {
    const err = new AppError('LIMIT_REACHED', 'BUSINESS_RULE', { field: 'x' }, { max: 5 });
    const ar = toErrorResponse(err, { locale: 'ar', requestId: 'req-1' }, catalog);
    const en = toErrorResponse(err, { locale: 'en', requestId: 'req-1' }, catalog);
    expect(ar.status).toBe(422);
    expect(ar.body.error.code).toBe('LIMIT_REACHED');
    expect(en.body.error.code).toBe('LIMIT_REACHED');
    expect(ar.body.error.message).toBe('تم بلوغ الحد 5');
    expect(en.body.error.message).toBe('Limit 5 reached');
    expect(ar.body.error.locale).toBe('ar');
    expect(ar.body.error.requestId).toBe('req-1');
    expect(ar.body.error.details).toEqual({ field: 'x' });
    expect(ar.body.success).toBe(false);
  });
  it('never exposes internals for unknown errors', () => {
    const r = toErrorResponse(new Error('SELECT * FROM secrets failed'), { locale: 'en' }, catalog);
    expect(r.status).toBe(500);
    expect(r.body.error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(r.body).includes('secrets')).toBe(false);
    expect('details' in r.body.error).toBe(false);
  });
  it('drops details for INTERNAL AppErrors', () => {
    const r = toErrorResponse(new AppError('X', 'INTERNAL', { sql: 'boom' }), { locale: 'en' }, catalog);
    expect('details' in r.body.error).toBe(false);
  });
  it('falls back to English for an unsupported locale', () => {
    const r = toErrorResponse(new AppError('LIMIT_REACHED', 'BUSINESS_RULE', undefined, { max: 1 }), { locale: 'fr' }, catalog);
    expect(r.body.error.locale).toBe('en');
    expect(r.body.error.message).toBe('Limit 1 reached');
  });
  it('omits requestId when absent', () => {
    const r = toErrorResponse(new AppError('LIMIT_REACHED', 'BUSINESS_RULE'), { locale: 'en' }, catalog);
    expect('requestId' in r.body.error).toBe(false);
  });
});

describe('field-level errors', () => {
  const c = new MessageCatalog();
  c.register([
    { code: ErrorCodes.INTERNAL_ERROR, message: { ar: 'خطأ داخلي', en: 'Internal error' } },
    { code: ErrorCodes.VALIDATION_FAILED, message: { ar: 'فشل التحقق', en: 'Validation failed' } },
    { code: 'TOO_LONG', message: { ar: 'الحد {max}', en: 'Max {max}' } },
  ]);
  const err = new AppError(ErrorCodes.VALIDATION_FAILED, 'VALIDATION', {
    fields: [
      { field: 'name', code: 'TOO_LONG', params: { max: 10 } },
      { field: 'x', code: 'NOT_REGISTERED' },
    ],
  });
  it('adds a localized message to each field', () => {
    const r = toErrorResponse(err, { locale: 'ar' }, c);
    expect(r.status).toBe(400);
    expect(r.body.error.details).toEqual({
      fields: [
        { field: 'name', code: 'TOO_LONG', message: 'الحد 10' },
        { field: 'x', code: 'NOT_REGISTERED', message: 'فشل التحقق' },
      ],
    });
  });
  it('keeps field codes identical across languages', () => {
    const en = toErrorResponse(err, { locale: 'en' }, c).body.error.details as { fields: Array<{ code: string; message: string }> };
    expect(en.fields[0]?.code).toBe('TOO_LONG');
    expect(en.fields[0]?.message).toBe('Max 10');
  });
});

describe('normalizeError', () => {
  it('maps body-parser errors', () => {
    expect(normalizeError({ type: 'entity.parse.failed' }).code).toBe('INVALID_JSON');
    expect(normalizeError({ type: 'entity.too.large' }).kind).toBe('PAYLOAD_TOO_LARGE');
  });
  it('maps everything else to INTERNAL_ERROR', () => {
    expect(normalizeError(null).code).toBe('INTERNAL_ERROR');
    expect(normalizeError('str').kind).toBe('INTERNAL');
  });
});
