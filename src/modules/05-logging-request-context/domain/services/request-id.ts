import { newUuid } from '../../../00-shared-kernel/public';

/** Accepted client-provided IDs: 8–64 chars of letters, digits, dot, underscore, hyphen. */
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{8,64}$/;

/**
 * Reuses a client-provided request/correlation ID only if it is safe
 * (it ends up in logs, headers, and responses); otherwise generates one.
 */
export function resolveRequestId(incoming: string | undefined): string {
  return incoming !== undefined && SAFE_REQUEST_ID.test(incoming) ? incoming : newUuid();
}
