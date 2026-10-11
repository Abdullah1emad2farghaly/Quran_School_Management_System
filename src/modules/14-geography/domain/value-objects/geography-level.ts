/**
 * Geography hierarchy (Master Specification §27): Country -> Governorate -> Center/City -> Village.
 * (School, the last level, belongs to Module 16.) Each level has its own table and references only its parent.
 */
export const GEOGRAPHY_LEVELS = ['COUNTRY', 'GOVERNORATE', 'CENTER', 'VILLAGE'] as const;
export type GeographyLevel = (typeof GEOGRAPHY_LEVELS)[number];

/** The level a node of `level` hangs under (`null` for a country). */
export const PARENT_LEVEL: Readonly<Record<GeographyLevel, GeographyLevel | null>> = Object.freeze({
  COUNTRY: null,
  GOVERNORATE: 'COUNTRY',
  CENTER: 'GOVERNORATE',
  VILLAGE: 'CENTER',
});

/** Code prefixes, `<PREFIX>-000001`. */
export const CODE_PREFIX: Readonly<Record<GeographyLevel, string>> = Object.freeze({
  COUNTRY: 'CNT',
  GOVERNORATE: 'GOV',
  CENTER: 'CTR',
  VILLAGE: 'VIL',
});

export function isGeographyLevel(value: unknown): value is GeographyLevel {
  return typeof value === 'string' && (GEOGRAPHY_LEVELS as readonly string[]).includes(value);
}

/** Center/City is ONE hierarchy level; `kind` tells them apart. */
export const CENTER_KINDS = ['CENTER', 'CITY'] as const;
export type CenterKind = (typeof CENTER_KINDS)[number];

export function isCenterKind(value: unknown): value is CenterKind {
  return typeof value === 'string' && (CENTER_KINDS as readonly string[]).includes(value);
}

/** Approved statuses. No transition (retire/reactivate) or rename operation exists: none is specified. */
export const GEOGRAPHY_STATUSES = ['ACTIVE', 'INACTIVE'] as const;
export type GeographyStatus = (typeof GEOGRAPHY_STATUSES)[number];

export function isGeographyStatus(value: unknown): value is GeographyStatus {
  return typeof value === 'string' && (GEOGRAPHY_STATUSES as readonly string[]).includes(value);
}
