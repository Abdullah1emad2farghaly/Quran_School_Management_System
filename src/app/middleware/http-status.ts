import type { ErrorKind } from '../../modules/00-shared-kernel/public';

/** HTTP mapping lives in the presentation layer, never in the domain. */
export const HTTP_STATUS_BY_KIND: Record<ErrorKind, number> = {
  VALIDATION: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  BUSINESS_RULE: 422,
  PAYLOAD_TOO_LARGE: 413,
  RATE_LIMITED: 429,
  INTERNAL: 500,
};
