import { AppError } from '../../modules/00-shared-kernel/public';
import type { OrganizationService } from '../../modules/13-organization-core/public';
import { EGYPT_COUNTRY_NAME, type GeographyLookup } from '../../modules/14-geography/public';
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

/** The code of the Egypt record created by `npm run seed:geography` (first country, fixed order). */
export const EGYPT_COUNTRY_CODE = 'CNT-000001';

/** Parses `npm run bootstrap:organization -- [--yes]`. Anything else is a usage error. */
export function parseOrganizationArgs(argv: readonly string[]): { yes: boolean } | { error: string } {
  const unknown = argv.filter((arg) => arg !== '--yes');
  if (unknown.length > 0) return { error: `Unknown argument: ${unknown[0]}. The only option is --yes.` };
  return { yes: argv.includes('--yes') };
}

export interface CountryPrompter {
  isInteractive(): boolean;
  /** Asks a yes/no question; true only for an explicit yes. */
  confirm(question: string): Promise<boolean>;
}

export interface CountryStepDeps {
  readonly prompter: CountryPrompter;
  /** `--yes`: skips ONLY the confirmation prompt. Every safety check below still runs. */
  readonly yes: boolean;
  readonly organizations: Pick<OrganizationService, 'getMainOrganization' | 'assignMainOrganizationCountry'>;
  readonly geography: Pick<GeographyLookup, 'getCountry' | 'listCountries'>;
  readonly describeCode?: (code: string) => string | undefined;
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
}

/**
 * Assigns Egypt as the country of the Main Organization (immutable in V1). Safe, auditable and repeatable:
 * - the organization must exist; an already assigned country is never changed (same country: reported, nothing changed;
 *   a different one: reported as a conflict and the step stops);
 * - the country is resolved from Geography BY CODE (CNT-000001) and its primary key (`id`) is what gets stored: it must
 *   exist, be named exactly `مصر` and be ACTIVE, otherwise nothing is changed;
 * - a confirmation is asked unless `--yes` was given (a non-interactive run without `--yes` is a usage error);
 * - the assignment writes the `OrganizationCountryAssigned` event in the same transaction.
 * Exit codes: 0 ok (assigned or already there), 1 failed or conflict or cancelled, 2 needs an interactive terminal or --yes.
 */
export async function runOrganizationCountryStep(deps: CountryStepDeps): Promise<number> {
  const { prompter, out, err } = deps;
  try {
    const organization = await deps.organizations.getMainOrganization();
    if (!organization) {
      err('The Main Organization does not exist yet; run npm run bootstrap:organization first. Nothing changed.');
      return EXIT_FAILED;
    }

    const countries = await deps.geography.listCountries();
    const egypt = countries.find((country) => country.code === EGYPT_COUNTRY_CODE);

    if (organization.countryId !== null) {
      const current = await deps.geography.getCountry(organization.countryId);
      if (!current) {
        err(`The Main Organization (${organization.code}) points to a country that does not exist. Resolve this manually; nothing was changed.`);
        return EXIT_FAILED;
      }
      if (egypt && current.id === egypt.id) {
        out(`The Main Organization country is already ${current.code} (${current.name}). Nothing changed.`);
        return EXIT_OK;
      }
      err(`CONFLICT: the Main Organization (${organization.code}) already has country ${current.code} (${current.name}), which is not ${EGYPT_COUNTRY_CODE}. The country is immutable in V1; nothing was changed.`);
      return EXIT_FAILED;
    }

    if (!egypt) {
      err(`Country ${EGYPT_COUNTRY_CODE} was not found. Run npm run db:migrate and npm run seed:geography first. Nothing changed.`);
      return EXIT_FAILED;
    }
    if (egypt.name !== EGYPT_COUNTRY_NAME) {
      err(`CONFLICT: ${EGYPT_COUNTRY_CODE} is named "${egypt.name}", not "${EGYPT_COUNTRY_NAME}". Nothing changed.`);
      return EXIT_FAILED;
    }
    if (egypt.status !== 'ACTIVE') {
      err(`CONFLICT: country ${EGYPT_COUNTRY_CODE} is not ACTIVE. Nothing changed.`);
      return EXIT_FAILED;
    }

    if (!deps.yes) {
      if (!prompter.isInteractive()) {
        err('Assigning the country needs an interactive terminal, or --yes for an approved scripted run. Nothing changed.');
        return EXIT_USAGE;
      }
      const ok = await prompter.confirm(`Assign country ${egypt.code} (${egypt.name}) to the Main Organization ${organization.code}? This cannot be changed later.`);
      if (!ok) {
        err('Cancelled. Nothing changed.');
        return EXIT_FAILED;
      }
    }

    // The primary key (UUID) of the countries row is stored, never the code.
    const { changed } = await deps.organizations.assignMainOrganizationCountry(egypt.id);
    out(changed ? `Main Organization country assigned: ${egypt.code} (${egypt.name}).` : `The Main Organization country is already ${egypt.code} (${egypt.name}). Nothing changed.`);
    return EXIT_OK;
  } catch (error) {
    if (error instanceof AppError) {
      const text = deps.describeCode?.(error.code);
      err(`The country was not assigned. [${error.code}]${text ? ` ${text}` : ''}`);
    } else {
      err(`The country was not assigned. Unexpected error (${error instanceof Error ? error.name : 'UnknownError'}); check that npm run db:migrate has been run.`);
    }
    return EXIT_FAILED;
  }
}
