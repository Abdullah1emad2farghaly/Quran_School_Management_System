import { describe, expect, it } from 'vitest';
import { resolveRequestId } from '../../src/app/middleware/request-context.middleware';

describe('resolveRequestId', () => {
  it('reuses a safe client-provided id', () => {
    expect(resolveRequestId('client-req-12345')).toBe('client-req-12345');
  });
  it('generates an id when missing or unsafe', () => {
    expect(resolveRequestId(undefined)).toMatch(/^[0-9a-f-]{36}$/);
    expect(resolveRequestId('bad id with spaces!')).toMatch(/^[0-9a-f-]{36}$/);
  });
});
