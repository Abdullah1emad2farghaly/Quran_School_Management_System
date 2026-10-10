import type { Sequelize } from 'sequelize';

/** `YYYY-MM-DD HH:mm:ss.SSS` in UTC, the exact form stored in DATETIME(3) columns. */
export function toUtcSqlDate(date: Date): string {
  return date.toISOString().slice(0, 23).replace('T', ' ');
}

const convert = (value: unknown): unknown => (value instanceof Date ? toUtcSqlDate(value) : value);

function convertReplacements(replacements: unknown): unknown {
  if (Array.isArray(replacements)) return replacements.map((v) => (Array.isArray(v) ? v.map(convert) : convert(v)));
  if (replacements !== null && typeof replacements === 'object') {
    return Object.fromEntries(
      Object.entries(replacements as Record<string, unknown>).map(([k, v]) => [k, Array.isArray(v) ? v.map(convert) : convert(v)]),
    );
  }
  return replacements;
}

/** Returns the query options with every `Date` in `replacements` turned into a UTC string. */
export function withUtcReplacements<T>(options: T): T {
  if (options === null || typeof options !== 'object' || !('replacements' in options)) return options;
  return { ...options, replacements: convertReplacements((options as { replacements?: unknown }).replacements) };
}

/**
 * Sequelize formats `Date` values inside `replacements` in the Node process' LOCAL time zone (it passes no time zone
 * to its formatter), but reads DATETIME columns back as UTC. On a server whose time zone is not UTC (for example
 * Africa/Cairo) every stored timestamp would come back shifted by the local offset, and by a different amount across
 * daylight-saving changes. This makes every query format its Date replacements in UTC, matching the connection's
 * `timezone: '+00:00'`, so timestamps round-trip exactly on any machine. Applies to every module that uses this
 * Sequelize instance.
 */
export function installUtcReplacements(sequelize: Sequelize): void {
  const original = sequelize.query.bind(sequelize) as (sql: unknown, options?: unknown) => Promise<unknown>;
  (sequelize as unknown as { query: unknown }).query = (sql: unknown, options?: unknown) => original(sql, withUtcReplacements(options));
}
