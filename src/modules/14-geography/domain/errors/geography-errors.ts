import { AppError, type ErrorKind } from '../../../00-shared-kernel/public';

export const GeographyErrorCodes = {
  INVALID_GEOGRAPHY_NAME: 'INVALID_GEOGRAPHY_NAME',
  GEOGRAPHY_NODE_NOT_FOUND: 'GEOGRAPHY_NODE_NOT_FOUND',
  /** The same name already exists under the same parent (and kind, for centers/cities) or the code is taken. */
  GEOGRAPHY_NODE_ALREADY_EXISTS: 'GEOGRAPHY_NODE_ALREADY_EXISTS',
  GEOGRAPHY_PARENT_NOT_FOUND: 'GEOGRAPHY_PARENT_NOT_FOUND',
  /** Governorate missing, village without center, or a node that is not under its stated parent. */
  INVALID_GEOGRAPHY_HIERARCHY: 'INVALID_GEOGRAPHY_HIERARCHY',
  GEOGRAPHY_NODE_INACTIVE: 'GEOGRAPHY_NODE_INACTIVE',
} as const;
export type GeographyErrorCode = (typeof GeographyErrorCodes)[keyof typeof GeographyErrorCodes];

const KIND: Record<GeographyErrorCode, ErrorKind> = {
  INVALID_GEOGRAPHY_NAME: 'VALIDATION',
  GEOGRAPHY_NODE_NOT_FOUND: 'NOT_FOUND',
  GEOGRAPHY_NODE_ALREADY_EXISTS: 'CONFLICT',
  GEOGRAPHY_PARENT_NOT_FOUND: 'NOT_FOUND',
  INVALID_GEOGRAPHY_HIERARCHY: 'VALIDATION',
  GEOGRAPHY_NODE_INACTIVE: 'VALIDATION',
};

export function geographyError(code: GeographyErrorCode): AppError {
  return new AppError(code, KIND[code]);
}
