import { describe, expect, it } from 'vitest';
import { ValidationError, parseListQuery, type ListQuerySpec } from '../../../src/modules/04-validation-api/public';

const UUID = '3f2b8c1e-5a4d-4e6f-9b7a-1c2d3e4f5a6b';

const spec: ListQuerySpec = {
  sortable: { name: 'name', createdAt: 'created_at' },
  defaultSort: [{ key: 'created_at', direction: 'desc' }],
  filters: {
    status: { type: 'enum', values: ['active', 'inactive'], multiple: true },
    schoolId: { type: 'uuid' },
    from: { type: 'date' },
    age: { type: 'integer' },
    archived: { type: 'boolean' },
  },
  search: { maxLength: 20 },
};

function fieldsOf(query: Record<string, unknown>, s: ListQuerySpec = spec) {
  try {
    parseListQuery(query, s);
  } catch (e) {
    if (e instanceof ValidationError) return e.fields;
    throw e;
  }
  return [];
}
const codes = (query: Record<string, unknown>) => fieldsOf(query).map((f) => f.code);

describe('pagination', () => {
  it('defaults to page 1, size 20 and the default sort', () => {
    const q = parseListQuery({}, spec);
    expect(q.page).toEqual({ page: 1, pageSize: 20 });
    expect(q.sort).toEqual([{ key: 'created_at', direction: 'desc' }]);
    expect(q.filters).toEqual({});
  });
  it('parses numbers and caps pageSize at 100', () => {
    expect(parseListQuery({ page: '3', pageSize: '500' }, spec).page).toEqual({ page: 3, pageSize: 100 });
  });
  it('rejects malformed values', () => {
    expect(codes({ page: '0' })).toEqual(['INVALID_PAGE']);
    expect(codes({ page: 'abc' })).toEqual(['INVALID_PAGE']);
    expect(codes({ pageSize: '-5' })).toEqual(['INVALID_PAGE_SIZE']);
    expect(codes({ page: ['1', '2'] })).toEqual(['INVALID_PAGE']);
  });
});

describe('sorting (whitelist)', () => {
  it('maps public names to internal keys and honors direction', () => {
    expect(parseListQuery({ sort: '-name,createdAt' }, spec).sort).toEqual([
      { key: 'name', direction: 'desc' },
      { key: 'created_at', direction: 'asc' },
    ]);
  });
  it('rejects fields that are not whitelisted, including raw column names and SQL', () => {
    expect(codes({ sort: 'password' })).toEqual(['UNKNOWN_SORT_FIELD']);
    expect(codes({ sort: 'created_at' })).toEqual(['UNKNOWN_SORT_FIELD']);
    expect(codes({ sort: 'name; DROP TABLE users' })).toEqual(['UNKNOWN_SORT_FIELD']);
    expect(codes({ sort: 'constructor' })).toEqual(['UNKNOWN_SORT_FIELD']);
  });
  it('rejects empty tokens, bad types and too many fields', () => {
    expect(codes({ sort: 'name,' })).toEqual(['INVALID_SORT']);
    expect(codes({ sort: ['name'] })).toEqual(['INVALID_SORT']);
    expect(codes({ sort: 'name,createdAt,name2,x' })).toEqual(['TOO_MANY_SORT_FIELDS']);
  });
  it('ignores duplicate fields', () => {
    expect(parseListQuery({ sort: 'name,-name' }, spec).sort).toEqual([{ key: 'name', direction: 'asc' }]);
  });
});

describe('filtering (whitelist)', () => {
  it('parses typed filters', () => {
    const q = parseListQuery(
      { filter: { status: 'active,inactive', schoolId: UUID, from: '2026-01-31', age: '12', archived: 'false' } },
      spec,
    );
    expect(q.filters).toEqual({
      status: ['active', 'inactive'],
      schoolId: UUID,
      from: '2026-01-31',
      age: 12,
      archived: false,
    });
  });
  it('rejects unknown filters', () => {
    expect(codes({ filter: { password: 'x' } })).toEqual(['UNKNOWN_FILTER']);
    expect(codes({ filter: { __proto__x: '1' } })).toEqual(['UNKNOWN_FILTER']);
  });
  it('rejects invalid values', () => {
    expect(codes({ filter: { status: 'deleted' } })).toEqual(['INVALID_FILTER_VALUE']);
    expect(codes({ filter: { schoolId: 'nope' } })).toEqual(['INVALID_FILTER_VALUE']);
    expect(codes({ filter: { from: '2026-02-30' } })).toEqual(['INVALID_FILTER_VALUE']);
    expect(codes({ filter: { age: '1.5' } })).toEqual(['INVALID_FILTER_VALUE']);
    expect(codes({ filter: { archived: 'yes' } })).toEqual(['INVALID_FILTER_VALUE']);
    expect(codes({ filter: { schoolId: [UUID, UUID] } })).toEqual(['INVALID_FILTER_VALUE']);
  });
  it('rejects a non-object filter parameter', () => {
    expect(codes({ filter: 'status=active' })).toEqual(['INVALID_FILTER']);
  });
});

describe('search and unknown parameters', () => {
  it('accepts and trims search; empty search is ignored', () => {
    expect(parseListQuery({ search: '  ali  ' }, spec).search).toBe('ali');
    expect(parseListQuery({ search: '   ' }, spec).search).toBe(undefined);
  });
  it('rejects overlong search', () => {
    expect(codes({ search: 'x'.repeat(21) })).toEqual(['INVALID_SEARCH']);
  });
  it('rejects unknown query parameters', () => {
    expect(codes({ limit: '5' })).toEqual(['UNKNOWN_QUERY_PARAMETER']);
    expect(codes({ search: 'a' }, ) ).toEqual([]);
  });
  it('does not accept search when the spec does not declare it', () => {
    const noSearch: ListQuerySpec = { sortable: {}, defaultSort: [] };
    expect(fieldsOf({ search: 'a' }, noSearch).map((f) => f.code)).toEqual(['UNKNOWN_QUERY_PARAMETER']);
  });
});

describe('error reporting', () => {
  it('reports all problems at once and never echoes submitted values for filters', () => {
    const fields = fieldsOf({ page: '0', sort: 'bad', filter: { age: 'secret-value' } });
    expect(fields.map((f) => f.code)).toEqual(['INVALID_PAGE', 'UNKNOWN_SORT_FIELD', 'INVALID_FILTER_VALUE']);
    expect(JSON.stringify(fields).includes('secret-value')).toBe(false);
  });
});
