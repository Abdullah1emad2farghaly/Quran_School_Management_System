import { describe, expect, it } from 'vitest';
import { AppError, ErrorCodes, ErrorKinds } from '../../../src/modules/00-shared-kernel/public';
import { HTTP_STATUS_BY_KIND } from '../../../src/modules/03-error-localization/public';

describe('AppError', () => {
  it('carries a stable code and kind, without HTTP knowledge', () => {
    const e = new AppError(ErrorCodes.NOT_FOUND, 'NOT_FOUND', { id: 1 });
    expect(e.code).toBe('NOT_FOUND');
    expect(e.kind).toBe('NOT_FOUND');
    expect(e instanceof Error).toBe(true);
    expect('httpStatus' in e).toBe(false);
  });
  it('can carry message params', () => {
    const e = new AppError('X', 'VALIDATION', undefined, { max: 5 });
    expect(e.params).toEqual({ max: 5 });
  });
  it('every error kind maps to an HTTP status', () => {
    for (const kind of ErrorKinds) expect(typeof HTTP_STATUS_BY_KIND[kind]).toBe('number');
  });
});
