/** `SC-000001`: globally unique, assigned from a gap-free transactional sequence (see school_code_sequence). */
export const SCHOOL_CODE_PATTERN = /^SC-[0-9]{6}$/;
export const MAX_SCHOOL_SEQUENCE = 999_999;

export const isSchoolCode = (value: unknown): value is string => typeof value === 'string' && SCHOOL_CODE_PATTERN.test(value);

export function formatSchoolCode(sequence: number): string {
  if (!Number.isInteger(sequence) || sequence < 1 || sequence > MAX_SCHOOL_SEQUENCE) throw new RangeError('School code sequence out of range');
  return `SC-${String(sequence).padStart(6, '0')}`;
}
