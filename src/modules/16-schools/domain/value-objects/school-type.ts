export const SCHOOL_TYPES = ['MAIN', 'SUB'] as const;
export type SchoolType = (typeof SCHOOL_TYPES)[number];
export const isSchoolType = (value: unknown): value is SchoolType => typeof value === 'string' && (SCHOOL_TYPES as readonly string[]).includes(value);
