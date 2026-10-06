export type LogFields = Readonly<Record<string, unknown>>;

/** Logging port. Fields are sanitized (secrets redacted) before being written. */
export interface Logger {
  error(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  debug(message: string, fields?: LogFields): void;
  /** A logger that adds fixed fields (e.g. { module: 'attendance' }) to every entry. */
  child(bindings: LogFields): Logger;
}
