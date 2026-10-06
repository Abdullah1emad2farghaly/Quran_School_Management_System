import type { ErrorMessageParams } from './app-error';

/**
 * One field-level validation problem. `code` is stable and language-independent;
 * the message is resolved from the code at the HTTP boundary. Submitted values
 * are never included (they may be sensitive).
 */
export interface FieldError {
  readonly field: string;
  readonly code: string;
  readonly params?: ErrorMessageParams;
}
