import { AppError } from '../../modules/00-shared-kernel/public';
import type { OrganizationService } from '../../modules/13-organization-core/public';
import { EXIT_FAILED, EXIT_OK, EXIT_USAGE } from './bootstrap-main-admin-cli';

export interface OrganizationPrompter {
  isInteractive(): boolean;
  /** The name is not a secret: it is shown as typed. Arabic or English. */
  askOrganizationName(): Promise<string>;
}

export interface OrganizationStepDeps {
  readonly prompter: OrganizationPrompter;
  readonly organizations: Pick<OrganizationService, 'getMainOrganization' | 'ensureMainOrganization'>;
  readonly describeCode?: (code: string) => string | undefined;
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
}

/**
 * Idempotent "ensure the Main Organization exists" step, shared by `bootstrap:organization` and `bootstrap:main-admin`.
 * If the organization exists it only reports it (no prompt, nothing changed, no event). Otherwise it asks for the name
 * once and creates it. Exit codes: 0 ok (created or already there), 1 failed, 2 needs an interactive terminal.
 */
export async function runOrganizationStep(deps: OrganizationStepDeps): Promise<number> {
  const { prompter, out, err } = deps;
  try {
    const existing = await deps.organizations.getMainOrganization();
    if (existing) {
      out(`Main Organization already exists (${existing.code}). Nothing changed.`);
      return EXIT_OK;
    }
    if (!prompter.isInteractive()) {
      err('The Main Organization does not exist yet; creating it needs an interactive terminal.');
      return EXIT_USAGE;
    }
    const name = await prompter.askOrganizationName();
    const { organization, created } = await deps.organizations.ensureMainOrganization(name);
    out(created ? `Main Organization created. Code: ${organization.code}` : `Main Organization already exists (${organization.code}). Nothing changed.`);
    return EXIT_OK;
  } catch (error) {
    if (error instanceof AppError) {
      const text = deps.describeCode?.(error.code);
      err(`Main Organization was not created. [${error.code}]${text ? ` ${text}` : ''}`);
    } else {
      err(`Main Organization was not created. Unexpected error (${error instanceof Error ? error.name : 'UnknownError'}); check that npm run db:migrate has been run.`);
    }
    return EXIT_FAILED;
  }
}
