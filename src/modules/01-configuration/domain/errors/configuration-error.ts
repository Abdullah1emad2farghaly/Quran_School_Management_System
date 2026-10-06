/**
 * Thrown at startup when configuration is invalid. Lists every problem at once.
 * Messages name variables only, never their values, so secrets cannot leak.
 */
export class ConfigurationError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`Invalid configuration:\n${issues.map((i) => ` - ${i}`).join('\n')}`);
    this.name = 'ConfigurationError';
    this.issues = issues;
  }
}
