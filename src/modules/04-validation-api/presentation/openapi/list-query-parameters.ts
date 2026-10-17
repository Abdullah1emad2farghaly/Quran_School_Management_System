import type { FilterDefinition, ListQuerySpec } from '../../application/dto/list-query';
import type { ParameterObject } from './types';

const DEFAULT_SEARCH_MAX_LENGTH = 100;
const DEFAULT_MAX_SORT_FIELDS = 3;
const DEFAULT_FILTER_MAX_LENGTH = 100;

function filterParameter(name: string, def: FilterDefinition): ParameterObject {
  const list = def.multiple === true;
  const base = { name: `filter[${name}]`, in: 'query' as const, required: false };
  const listNote = list ? ' Accepts a comma-separated list (at most 50 values).' : '';
  switch (def.type) {
    case 'enum': {
      const values = def.values ?? [];
      return {
        ...base,
        description: `Filter by ${name}. One of: ${values.join(', ')}.${listNote}`,
        schema: list ? { type: 'string' } : { type: 'string', enum: [...values] },
        example: list ? values.slice(0, 2).join(',') : values[0],
      };
    }
    case 'integer':
      return { ...base, description: `Filter by ${name} (integer).${listNote}`, schema: { type: 'string', pattern: '^-?\\d+$' }, example: list ? '1,2' : '1' };
    case 'boolean':
      return { ...base, description: `Filter by ${name}: "true" or "false".${listNote}`, schema: { type: 'string', enum: ['true', 'false'] }, example: list ? 'true,false' : 'true' };
    case 'uuid':
      return { ...base, description: `Filter by ${name} (UUID).${listNote}`, schema: { type: 'string', format: 'uuid' }, example: '3f6b1d52-8a4e-4c1b-9d77-2b6f0c9a1e10' };
    case 'date':
      return { ...base, description: `Filter by ${name} (ISO date, YYYY-MM-DD).${listNote}`, schema: { type: 'string', format: 'date' }, example: '2026-01-31' };
    case 'string':
      return {
        ...base,
        description: `Filter by ${name} (1–${def.maxLength ?? DEFAULT_FILTER_MAX_LENGTH} characters).${listNote}`,
        schema: { type: 'string', minLength: 1, maxLength: def.maxLength ?? DEFAULT_FILTER_MAX_LENGTH },
        example: 'value',
      };
  }
}

/**
 * The standard list query parameters (page, pageSize, sort, filter[...], search), generated from the SAME `ListQuerySpec`
 * that `parseListQuery` enforces, so the documented whitelist can never drift from the real one.
 * Behaviours mirrored from `parseListQuery`: default page 1, default pageSize 20, pageSize above 100 is capped (not rejected),
 * unknown parameters are rejected, at most `maxSortFields` sort fields.
 */
export function listQueryParameters(spec: ListQuerySpec): ParameterObject[] {
  const sortable = Object.keys(spec.sortable);
  const maxSort = spec.maxSortFields ?? DEFAULT_MAX_SORT_FIELDS;
  const defaultSort = spec.defaultSort.map((s) => `${s.direction === 'desc' ? '-' : ''}${Object.keys(spec.sortable).find((k) => spec.sortable[k] === s.key) ?? s.key}`).join(',');
  const parameters: ParameterObject[] = [
    {
      name: 'page',
      in: 'query',
      required: false,
      description: 'Page number, starting at 1.',
      schema: { type: 'string', pattern: '^[1-9]\\d*$', default: '1' },
      example: '1',
    },
    {
      name: 'pageSize',
      in: 'query',
      required: false,
      description: 'Items per page. Default 20. Values above 100 are capped at 100 (not rejected).',
      schema: { type: 'string', pattern: '^[1-9]\\d*$', default: '20' },
      example: '20',
    },
    {
      name: 'sort',
      in: 'query',
      required: false,
      description: `Comma-separated sort fields; a leading "-" means descending. Allowed fields: ${sortable.join(', ')}. At most ${maxSort} fields. Default: ${defaultSort}.`,
      schema: { type: 'string' },
      example: defaultSort,
    },
  ];
  for (const [name, def] of Object.entries(spec.filters ?? {})) parameters.push(filterParameter(name, def));
  if (spec.search) {
    parameters.push({
      name: 'search',
      in: 'query',
      required: false,
      description: `Free-text search (at most ${spec.search.maxLength ?? DEFAULT_SEARCH_MAX_LENGTH} characters).`,
      schema: { type: 'string', maxLength: spec.search.maxLength ?? DEFAULT_SEARCH_MAX_LENGTH },
      example: 'text',
    });
  }
  return parameters;
}
