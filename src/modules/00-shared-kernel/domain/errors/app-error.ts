/**
 * Transport-agnostic error categories. The HTTP layer maps a kind to a status
 * code; the domain never knows about HTTP.
 */
export const ErrorKinds = [
  'VALIDATION',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'BUSINESS_RULE',
  'PAYLOAD_TOO_LARGE',
  'INTERNAL',
] as const;
export type ErrorKind = (typeof ErrorKinds)[number];

export type ErrorMessageParams = Readonly<Record<string, string | number>>;

/**
 * Base application error. `code` is a stable, language-independent identifier.
 * User-facing messages are resolved from the code at the presentation boundary.
 * - `details`: structured, client-safe data (never sent for INTERNAL errors).
 * - `params`: values interpolated into the localized message, e.g. {max}.
 */
export class AppError extends Error {
  readonly code: string;
  readonly kind: ErrorKind;
  readonly details?: unknown;
  readonly params?: ErrorMessageParams;

  constructor(code: string, kind: ErrorKind, details?: unknown, params?: ErrorMessageParams) {
    super(code);
    this.name = 'AppError';
    this.code = code;
    this.kind = kind;
    this.details = details;
    this.params = params;
  }
}
