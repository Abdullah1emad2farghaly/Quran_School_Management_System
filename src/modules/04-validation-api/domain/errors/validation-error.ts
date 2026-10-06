import { AppError, ErrorCodes, type FieldError } from '../../../00-shared-kernel/public';

/** Request validation failure with one or more field-level errors. */
export class ValidationError extends AppError {
  readonly fields: readonly FieldError[];

  constructor(fields: readonly FieldError[]) {
    super(ErrorCodes.VALIDATION_FAILED, 'VALIDATION', { fields });
    this.name = 'ValidationError';
    this.fields = fields;
  }
}
