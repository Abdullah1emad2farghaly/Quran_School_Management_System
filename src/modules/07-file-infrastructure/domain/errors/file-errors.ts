import { AppError, type ErrorKind } from '../../../00-shared-kernel/public';

export const FileErrorCodes = {
  FILE_EMPTY: 'FILE_EMPTY',
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',
  FILE_TYPE_NOT_ALLOWED: 'FILE_TYPE_NOT_ALLOWED',
  FILE_CORRUPT: 'FILE_CORRUPT',
  FILE_UNSAFE_CONTENT: 'FILE_UNSAFE_CONTENT',
  FILE_NOT_FOUND: 'FILE_NOT_FOUND',
  FILE_INTEGRITY_FAILED: 'FILE_INTEGRITY_FAILED',
} as const;
export type FileErrorCode = (typeof FileErrorCodes)[keyof typeof FileErrorCodes];

const KIND: Record<FileErrorCode, ErrorKind> = {
  FILE_EMPTY: 'VALIDATION',
  FILE_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  FILE_TYPE_NOT_ALLOWED: 'VALIDATION',
  FILE_CORRUPT: 'VALIDATION',
  FILE_UNSAFE_CONTENT: 'VALIDATION',
  FILE_NOT_FOUND: 'NOT_FOUND',
  FILE_INTEGRITY_FAILED: 'INTERNAL',
};

export function fileError(code: FileErrorCode, params?: Record<string, string | number>): AppError {
  return new AppError(code, KIND[code], undefined, params);
}
