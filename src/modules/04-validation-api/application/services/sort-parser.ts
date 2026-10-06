import type { FieldError } from '../../../00-shared-kernel/public';
import type { SortSpec } from '../dto/list-query';

const FIELD_NAME = /^[A-Za-z][A-Za-z0-9_]{0,49}$/;
export const DEFAULT_MAX_SORT_FIELDS = 3;

const hasOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

/**
 * Parses `sort=name,-createdAt` against a whitelist. A leading "-" means descending.
 * Clients can only use public names from the whitelist; internal keys come from it.
 */
export function parseSort(
  raw: unknown,
  sortable: Readonly<Record<string, string>>,
  defaultSort: readonly SortSpec[],
  maxFields: number,
  errors: FieldError[],
): SortSpec[] {
  if (raw === undefined) return [...defaultSort];
  if (typeof raw !== 'string') {
    errors.push({ field: 'sort', code: 'INVALID_SORT' });
    return [];
  }
  const tokens = raw.split(',');
  if (tokens.length > maxFields) {
    errors.push({ field: 'sort', code: 'TOO_MANY_SORT_FIELDS', params: { max: maxFields } });
    return [];
  }
  const result: SortSpec[] = [];
  const seen = new Set<string>();
  for (const rawToken of tokens) {
    const token = rawToken.trim();
    if (token === '' || token === '-') {
      errors.push({ field: 'sort', code: 'INVALID_SORT' });
      continue;
    }
    const descending = token.startsWith('-');
    const name = descending ? token.slice(1) : token;
    if (!FIELD_NAME.test(name) || !hasOwn(sortable, name)) {
      errors.push({ field: 'sort', code: 'UNKNOWN_SORT_FIELD', params: { field: name.slice(0, 50) } });
      continue;
    }
    if (seen.has(name)) continue;
    seen.add(name);
    result.push({ key: sortable[name] as string, direction: descending ? 'desc' : 'asc' });
  }
  return result;
}
