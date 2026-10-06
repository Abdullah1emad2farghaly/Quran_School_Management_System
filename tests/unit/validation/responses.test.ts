import { describe, expect, it } from 'vitest';
import { buildPageResult, normalizePageRequest } from '../../../src/modules/00-shared-kernel/public';
import {
  VALIDATION_ERROR_MESSAGES,
  fieldErrorsFromValidationResult,
  paginatedBody,
  successBody,
} from '../../../src/modules/04-validation-api/public';
import { MessageCatalog } from '../../../src/modules/03-error-localization/public';

describe('successBody', () => {
  it('wraps data in the standard envelope', () => {
    expect(successBody({ a: 1 }, { requestId: 'r1' })).toEqual({ success: true, data: { a: 1 }, requestId: 'r1' });
    expect(successBody(1)).toEqual({ success: true, data: 1 });
  });
  it('includes meta when given', () => {
    expect(successBody([], { meta: { x: 1 } })).toEqual({ success: true, data: [], meta: { x: 1 } });
  });
});

describe('paginatedBody', () => {
  it('puts items in data and paging in meta', () => {
    const req = normalizePageRequest({ page: 2, pageSize: 10 });
    const body = paginatedBody(buildPageResult(['a', 'b'], 25, req), 'r1');
    expect(body).toEqual({
      success: true,
      data: ['a', 'b'],
      meta: { page: 2, pageSize: 10, total: 25, totalPages: 3 },
      requestId: 'r1',
    });
  });
});

describe('fieldErrorsFromValidationResult', () => {
  it('uses stable codes as messages and falls back to INVALID_VALUE', () => {
    expect(
      fieldErrorsFromValidationResult([
        { path: 'name', msg: 'REQUIRED_FIELD' },
        { path: 'age', msg: 'Invalid value' },
        { msg: 'REQUIRED_FIELD' },
      ]),
    ).toEqual([
      { field: 'name', code: 'REQUIRED_FIELD' },
      { field: 'age', code: 'INVALID_VALUE' },
      { field: '_', code: 'REQUIRED_FIELD' },
    ]);
  });
});

describe('validation messages', () => {
  it('register cleanly with both languages', () => {
    const c = new MessageCatalog();
    c.register(VALIDATION_ERROR_MESSAGES);
    expect(c.message('UNKNOWN_SORT_FIELD', 'ar', { field: 'x' })).toBe('لا يمكن الترتيب حسب "x".');
    expect(c.message('TOO_MANY_SORT_FIELDS', 'en', { max: 3 })).toBe('At most 3 sort fields are allowed.');
  });
});
