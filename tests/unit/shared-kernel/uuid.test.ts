import { describe, expect, it } from 'vitest';
import { asUuid, isUuid, newUuid } from '../../../src/modules/00-shared-kernel/public';

describe('uuid', () => {
  it('generates valid ids', () => {
    expect(isUuid(newUuid())).toBe(true);
  });
  it('rejects invalid values', () => {
    expect(isUuid('nope')).toBe(false);
    expect(isUuid(123)).toBe(false);
    expect(() => asUuid('nope')).toThrow();
  });
});
