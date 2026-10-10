import { AppError } from '../../modules/00-shared-kernel/public';
import type { BootstrapMainAdmin } from '../../modules/12-authorization-engine/public';

export const EXIT_OK = 0;
export const EXIT_FAILED = 1;
export const EXIT_USAGE = 2;

/** Where the credentials come from. The real one is an interactive terminal; tests use a fake. */
export interface CredentialPrompter {
  /** False when there is no interactive terminal (credentials are never read from arguments, environment or pipes). */
  isInteractive(): boolean;
  askPhone(): Promise<string>;
  /** Must not echo what is typed. */
  askPassword(label: string): Promise<string>;
}

export interface BootstrapCliDeps {
  readonly prompter: CredentialPrompter;
  readonly bootstrap: Pick<BootstrapMainAdmin, 'execute'>;
  /** English text for a stable error code, when known. */
  readonly describeCode?: (code: string) => string | undefined;
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
}

/**
 * The one-time "first Main Admin" operation. It prints the new user's id and NEVER the phone or the password, and it
 * never logs them. Returns the process exit code: 0 created, 1 refused/failed (nothing was created), 2 not interactive.
 */
export async function runBootstrapMainAdminCli(deps: BootstrapCliDeps): Promise<number> {
  const { prompter, out, err } = deps;

  if (!prompter.isInteractive()) {
    err('This command needs an interactive terminal: the password is typed at a hidden prompt and is never read from arguments or the environment.');
    return EXIT_USAGE;
  }

  out('Create the first Main Admin (one-time setup). Nothing is created if any step fails.');
  const phone = await prompter.askPhone();
  const password = await prompter.askPassword('Password');
  const confirmation = await prompter.askPassword('Repeat password');
  if (password !== confirmation) {
    err('The two passwords do not match. Nothing was created.');
    return EXIT_FAILED;
  }

  try {
    const { userId } = await deps.bootstrap.execute({ phone, password });
    out('Main Admin created.');
    out(`User id: ${userId}`);
    out('Sign in with POST /api/v1/auth/login using that phone number and password.');
    return EXIT_OK;
  } catch (error) {
    if (error instanceof AppError) {
      const text = deps.describeCode?.(error.code);
      err(`Nothing was created. [${error.code}]${text ? ` ${text}` : ''}`);
    } else {
      // Name only: a driver error message could carry details we should not print.
      err(`Nothing was created. Unexpected error (${error instanceof Error ? error.name : 'UnknownError'}); check the server log and that npm run db:migrate has been run.`);
    }
    return EXIT_FAILED;
  }
}
