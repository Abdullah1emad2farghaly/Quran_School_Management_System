import { describe, expect, it } from 'vitest';
import { buildPageResult, normalizePageRequest, pageOffset } from '../../../src/modules/00-shared-kernel/public';

describe('pagination', () => {
  it('defaults to page 1, size 20', () => {
    expect(normalizePageRequest()).toEqual({ page: 1, pageSize: 20 });
  });
  it('caps size at 100 and parses strings', () => {
    expect(normalizePageRequest({ page: '3', pageSize: '500' })).toEqual({ page: 3, pageSize: 100 });
  });
  it('falls back for invalid input', () => {
    expect(normalizePageRequest({ page: -1, pageSize: 'abc' })).toEqual({ page: 1, pageSize: 20 });
    expect(normalizePageRequest({ page: 1.5, pageSize: 0 })).toEqual({ page: 1, pageSize: 20 });
  });
  it('computes offset and totals', () => {
    const req = normalizePageRequest({ page: 3, pageSize: 10 });
    expect(pageOffset(req)).toBe(20);
    expect(buildPageResult([], 25, req).totalPages).toBe(3);
    expect(buildPageResult([], 0, req).totalPages).toBe(0);
  });
});
