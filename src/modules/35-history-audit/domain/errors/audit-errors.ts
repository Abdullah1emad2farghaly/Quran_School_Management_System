import { AppError, type ErrorKind } from '../../../00-shared-kernel/public';

export const AuditErrorCodes = {
  /** The record does not exist OR is outside the caller's scope (indistinguishable, so ids cannot be probed). */
  AUDIT_RECORD_NOT_FOUND: 'AUDIT_RECORD_NOT_FOUND',
} as const;
export type AuditErrorCode = (typeof AuditErrorCodes)[keyof typeof AuditErrorCodes];

const KIND: Record<AuditErrorCode, ErrorKind> = { AUDIT_RECORD_NOT_FOUND: 'NOT_FOUND' };

export function auditError(code: AuditErrorCode, details?: unknown): AppError {
  return new AppError(code, KIND[code], details);
}
