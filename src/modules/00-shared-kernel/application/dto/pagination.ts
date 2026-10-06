export const PAGINATION = { DEFAULT_PAGE_SIZE: 20, MAX_PAGE_SIZE: 100 } as const;

export type SortDirection = 'asc' | 'desc';

export interface PageRequest {
  readonly page: number; // 1-based
  readonly pageSize: number;
}

export interface PageResult<T> {
  readonly items: readonly T[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
  readonly totalPages: number;
}

function positiveInt(value: unknown): number | undefined {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof n === 'number' && Number.isInteger(n) && n >= 1 ? n : undefined;
}

/** Defaults: page 1, size 20. Size is capped at 100. Invalid values fall back to defaults. */
export function normalizePageRequest(input: { page?: unknown; pageSize?: unknown } = {}): PageRequest {
  const page = positiveInt(input.page) ?? 1;
  const requested = positiveInt(input.pageSize) ?? PAGINATION.DEFAULT_PAGE_SIZE;
  return { page, pageSize: Math.min(requested, PAGINATION.MAX_PAGE_SIZE) };
}

export function pageOffset(request: PageRequest): number {
  return (request.page - 1) * request.pageSize;
}

export function buildPageResult<T>(items: readonly T[], total: number, request: PageRequest): PageResult<T> {
  return {
    items,
    page: request.page,
    pageSize: request.pageSize,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / request.pageSize),
  };
}
