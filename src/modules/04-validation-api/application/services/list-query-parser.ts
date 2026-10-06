import { normalizePageRequest, type FieldError } from '../../../00-shared-kernel/public';
import { ValidationError } from '../../domain/errors/validation-error';
import type { ListQuery, ListQuerySpec } from '../dto/list-query';
import { parseFilters } from './filter-parser';
import { DEFAULT_MAX_SORT_FIELDS, parseSort } from './sort-parser';

const DEFAULT_SEARCH_MAX_LENGTH = 100;

function positiveInt(raw: unknown, field: string, code: string, errors: FieldError[]): number | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw === 'string' && /^\d+$/.test(raw)) {
    const n = Number(raw);
    if (Number.isSafeInteger(n) && n >= 1) return n;
  }
  errors.push({ field, code });
  return undefined;
}

/**
 * Parses and validates a list endpoint's query string against its spec:
 * page/pageSize (default 20, max 100 — larger sizes are capped), whitelisted
 * sort and filters, optional search. Unknown parameters are rejected.
 * Throws ValidationError with ALL problems at once.
 */
export function parseListQuery(query: Readonly<Record<string, unknown>>, spec: ListQuerySpec): ListQuery {
  const errors: FieldError[] = [];

  const allowed = new Set(['page', 'pageSize', 'sort', 'filter', ...(spec.search ? ['search'] : [])]);
  for (const key of Object.keys(query)) {
    if (!allowed.has(key)) {
      errors.push({ field: key.slice(0, 50), code: 'UNKNOWN_QUERY_PARAMETER', params: { field: key.slice(0, 50) } });
    }
  }

  const page = positiveInt(query.page, 'page', 'INVALID_PAGE', errors);
  const pageSize = positiveInt(query.pageSize, 'pageSize', 'INVALID_PAGE_SIZE', errors);

  const sort = parseSort(
    query.sort,
    spec.sortable,
    spec.defaultSort,
    spec.maxSortFields ?? DEFAULT_MAX_SORT_FIELDS,
    errors,
  );
  const filters = parseFilters(query.filter, spec.filters ?? {}, errors);

  let search: string | undefined;
  if (spec.search && query.search !== undefined) {
    const maxLength = spec.search.maxLength ?? DEFAULT_SEARCH_MAX_LENGTH;
    if (typeof query.search !== 'string' || query.search.trim().length > maxLength) {
      errors.push({ field: 'search', code: 'INVALID_SEARCH' });
    } else if (query.search.trim() !== '') {
      search = query.search.trim();
    }
  }

  if (errors.length > 0) throw new ValidationError(errors);

  return {
    page: normalizePageRequest({ page, pageSize }),
    sort,
    filters,
    ...(search !== undefined ? { search } : {}),
  };
}
