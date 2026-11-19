import type { ErrorMessageEntry } from '../../../03-error-localization/public';
import { AuditErrorCodes } from '../../domain/errors/audit-errors';

export const AUDIT_ERROR_MESSAGES: readonly ErrorMessageEntry[] = [
  {
    code: AuditErrorCodes.AUDIT_RECORD_NOT_FOUND,
    message: { ar: 'سجل المراجعة غير موجود.', en: 'The audit record was not found.' },
  },
];
