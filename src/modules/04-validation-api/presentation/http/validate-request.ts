import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { validationResult, type ValidationChain } from 'express-validator';
import type { FieldError } from '../../../00-shared-kernel/public';
import { ValidationError } from '../../domain/errors/validation-error';

const CODE_PATTERN = /^[A-Z][A-Z0-9_]*$/;

/**
 * Converts express-validator errors to FieldErrors. Convention: chains use a
 * stable error code as their message, e.g. `.notEmpty().withMessage('REQUIRED_FIELD')`.
 * Anything else becomes INVALID_VALUE. Submitted values are never included.
 */
export function fieldErrorsFromValidationResult(
  errors: ReadonlyArray<{ path?: unknown; msg?: unknown }>,
): FieldError[] {
  return errors.map((e) => ({
    field: typeof e.path === 'string' && e.path !== '' ? e.path : '_',
    code: typeof e.msg === 'string' && CODE_PATTERN.test(e.msg) ? e.msg : 'INVALID_VALUE',
  }));
}

/** Runs express-validator chains and forwards a ValidationError listing every failing field. */
export function validate(...chains: ValidationChain[]): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      await Promise.all(chains.map((chain) => chain.run(req)));
      const result = validationResult(req);
      if (result.isEmpty()) {
        next();
      } else {
        next(new ValidationError(fieldErrorsFromValidationResult(result.array({ onlyFirstError: true }))));
      }
    } catch (error) {
      next(error);
    }
  };
}
