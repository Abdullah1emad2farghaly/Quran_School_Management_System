import type { Response } from 'express';
import type { PageResult } from '../../../00-shared-kernel/public';

/** Standard success envelope: { success:true, data, meta?, requestId? } */
export interface SuccessBody<T> {
  readonly success: true;
  readonly data: T;
  readonly meta?: Readonly<Record<string, unknown>>;
  readonly requestId?: string;
}

export function successBody<T>(
  data: T,
  options: { meta?: Readonly<Record<string, unknown>>; requestId?: string } = {},
): SuccessBody<T> {
  return {
    success: true,
    data,
    ...(options.meta ? { meta: options.meta } : {}),
    ...(options.requestId ? { requestId: options.requestId } : {}),
  };
}

export function paginatedBody<T>(result: PageResult<T>, requestId?: string): SuccessBody<readonly T[]> {
  return successBody(result.items, {
    meta: {
      page: result.page,
      pageSize: result.pageSize,
      total: result.total,
      totalPages: result.totalPages,
    },
    ...(requestId ? { requestId } : {}),
  });
}

/** The request id is set on the response by the request-context middleware. */
function requestIdOf(res: Response): string | undefined {
  const header = res.getHeader('X-Request-Id');
  return typeof header === 'string' && header !== '' ? header : undefined;
}

export function sendSuccess<T>(res: Response, data: T, options: { status?: number; meta?: Readonly<Record<string, unknown>> } = {}): void {
  const requestId = requestIdOf(res);
  res.status(options.status ?? 200).json(
    successBody(data, { ...(options.meta ? { meta: options.meta } : {}), ...(requestId ? { requestId } : {}) }),
  );
}

export function sendCreated<T>(res: Response, data: T): void {
  sendSuccess(res, data, { status: 201 });
}

export function sendPaginated<T>(res: Response, result: PageResult<T>): void {
  res.status(200).json(paginatedBody(result, requestIdOf(res)));
}

export function sendNoContent(res: Response): void {
  res.status(204).end();
}
