import { isIsoDate, isUuid, type FieldError } from '../../../00-shared-kernel/public';
import type { FilterDefinition, FilterValue } from '../dto/list-query';

const MAX_LIST_ITEMS = 50;
const DEFAULT_MAX_LENGTH = 100;
const hasOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

type Scalar = string | number | boolean;

function parseScalar(raw: string, def: FilterDefinition): Scalar | undefined {
  switch (def.type) {
    case 'string':
      return raw.length >= 1 && raw.length <= (def.maxLength ?? DEFAULT_MAX_LENGTH) ? raw : undefined;
    case 'integer': {
      if (!/^-?\d+$/.test(raw)) return undefined;
      const n = Number(raw);
      return Number.isSafeInteger(n) ? n : undefined;
    }
    case 'boolean':
      return raw === 'true' ? true : raw === 'false' ? false : undefined;
    case 'uuid':
      return isUuid(raw) ? raw : undefined;
    case 'date':
      return isIsoDate(raw) ? raw : undefined;
    case 'enum':
      return def.values?.includes(raw) ? raw : undefined;
  }
}

export function parseFilterValue(raw: string, def: FilterDefinition): FilterValue | undefined {
  const text = raw.trim();
  if (!def.multiple) return parseScalar(text, def);
  const parts = text.split(',').map((p) => p.trim());
  if (parts.length === 0 || parts.length > MAX_LIST_ITEMS) return undefined;
  const values: Scalar[] = [];
  for (const part of parts) {
    const v = parseScalar(part, def);
    if (v === undefined) return undefined;
    values.push(v);
  }
  return values as unknown as FilterValue;
}

/** Parses `filter[name]=value` against a whitelist; unknown or malformed filters are errors. */
export function parseFilters(
  raw: unknown,
  definitions: Readonly<Record<string, FilterDefinition>>,
  errors: FieldError[],
): Record<string, FilterValue> {
  const result: Record<string, FilterValue> = {};
  if (raw === undefined) return result;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    errors.push({ field: 'filter', code: 'INVALID_FILTER' });
    return result;
  }
  for (const key of Object.keys(raw)) {
    const field = `filter[${key.slice(0, 50)}]`;
    if (!hasOwn(definitions, key)) {
      errors.push({ field, code: 'UNKNOWN_FILTER', params: { field: key.slice(0, 50) } });
      continue;
    }
    const value = (raw as Record<string, unknown>)[key];
    const parsed = typeof value === 'string' ? parseFilterValue(value, definitions[key] as FilterDefinition) : undefined;
    if (parsed === undefined) errors.push({ field, code: 'INVALID_FILTER_VALUE' });
    else result[key] = parsed;
  }
  return result;
}
