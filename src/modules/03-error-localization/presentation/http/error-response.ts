import { AppError, ErrorCodes, type ErrorKind, type FieldError } from '../../../00-shared-kernel/public';
import { FALLBACK_LOCALE, isLocale, type Locale } from '../../../01-configuration/public';
import type { MessageCatalog } from '../../application/services/message-catalog';
import { defaultMessageCatalog } from '../../infrastructure/services/default-catalog';

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

export interface ErrorResponseContext {
  readonly locale: string;
  readonly requestId?: string;
}

export interface ErrorResponseBody {
  readonly success: false;
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly locale: Locale;
    readonly requestId?: string;
    readonly details?: unknown;
  };
}

/** Converts anything thrown into an AppError. Unknown errors become INTERNAL_ERROR. */
export function normalizeError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  const type = (err as { type?: string } | null | undefined)?.type;
  if (type === 'entity.parse.failed') return new AppError(ErrorCodes.INVALID_JSON, 'VALIDATION');
  if (type === 'entity.too.large') return new AppError(ErrorCodes.PAYLOAD_TOO_LARGE, 'PAYLOAD_TOO_LARGE');
  return new AppError(ErrorCodes.INTERNAL_ERROR, 'INTERNAL');
}

/**
 * Field-level errors travel as details.fields[{ field, code, params? }].
 * Each gets a localized `message`; unknown field codes use the generic
 * validation message. Other details are passed through unchanged.
 */
function localizeDetails(details: unknown, locale: Locale, catalog: MessageCatalog): unknown {
  if (!details || typeof details !== 'object') return details;
  const fields = (details as { fields?: unknown }).fields;
  if (!Array.isArray(fields)) return details;
  const localized = fields.map((item: unknown) => {
    const f = item as Partial<FieldError> | null;
    if (!f || typeof f.code !== 'string') return item;
    const messageCode = catalog.has(f.code) ? f.code : ErrorCodes.VALIDATION_FAILED;
    return { field: f.field, code: f.code, message: catalog.message(messageCode, locale, f.params) };
  });
  return { ...(details as object), fields: localized };
}

/**
 * Builds the standard error response:
 * { success:false, error:{ code, message, locale, requestId, details? } }
 * The code never depends on language. Internal errors never expose details,
 * stack traces, SQL, or the original error message.
 */
export function toErrorResponse(
  err: unknown,
  context: ErrorResponseContext,
  catalog: MessageCatalog = defaultMessageCatalog,
): { status: number; body: ErrorResponseBody } {
  const appError = normalizeError(err);
  const locale: Locale = isLocale(context.locale) ? context.locale : FALLBACK_LOCALE;
  const exposeDetails = appError.kind !== 'INTERNAL' && appError.details !== undefined;

  return {
    status: HTTP_STATUS_BY_KIND[appError.kind],
    body: {
      success: false,
      error: {
        code: appError.code,
        message: catalog.message(appError.code, locale, appError.params),
        locale,
        ...(context.requestId ? { requestId: context.requestId } : {}),
        ...(exposeDetails ? { details: localizeDetails(appError.details, locale, catalog) } : {}),
      },
    },
  };
}
