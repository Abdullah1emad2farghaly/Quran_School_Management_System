import { randomUUID } from 'node:crypto';
import { AppError } from '../errors/app-error';
import { ErrorCodes } from '../errors/error-codes';

declare const uuidBrand: unique symbol;
/** Internal technical identifier (UUID). */
export type Uuid = string & { readonly [uuidBrand]: true };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is Uuid {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

export function newUuid(): Uuid {
  return randomUUID() as Uuid;
}

export function asUuid(value: unknown): Uuid {
  if (!isUuid(value)) throw new AppError(ErrorCodes.INVALID_IDENTIFIER, 'VALIDATION');
  return value;
}
