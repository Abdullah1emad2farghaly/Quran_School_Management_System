/**
 * One-time CLI: ensures the Main Organization exists (Module 13, idempotent), then creates the FIRST Main Admin
 * (there is no registration endpoint). Run `npm run db:migrate` first, then
 * `npm run bootstrap:main-admin` in an interactive terminal. Refuses when an active Main Admin already exists.
 */
import { closeDatabase } from '../../config/database';
import { getBootstrapMainAdmin } from '../../config/authorization';
import { getGeographyService } from '../../config/geography';
import { getOrganizationService } from '../../config/organization';
import { defaultMessageCatalog } from '../../modules/03-error-localization/public';
import { registerAllErrorMessages } from '../bootstrap/register-error-messages';
import { EXIT_FAILED, EXIT_OK, runBootstrapMainAdminCli } from './bootstrap-main-admin-cli';
import { runOrganizationCountryStep, runOrganizationStep } from './bootstrap-organization-cli';
import { TerminalPrompter } from './terminal-prompter';

async function main(): Promise<number> {
  registerAllErrorMessages();
  const prompter = new TerminalPrompter();
  try {
    const describeCode = (code: string) => (defaultMessageCatalog.has(code) ? defaultMessageCatalog.message(code, 'en') : undefined);
    const out = (line: string) => console.log(line);
    const err = (line: string) => console.error(line);
    return await runBootstrapMainAdminCli({
      prompter,
      bootstrap: getBootstrapMainAdmin(),
      describeCode,
      out,
      err,
      // The Main Organization is ensured first (idempotent: an existing one is only reported). A failure stops the command.
      // Then the country step runs (confirmation required here; use `bootstrap:organization -- --yes` for scripted runs).
      // It is ADVISORY in this command: if it cannot complete (for example the geography seed has not been run yet) the
      // Main Admin is still created and the country is assigned later with `npm run bootstrap:organization`.
      // The MAIN_ADMIN role is scoped to organizations: the new Main Admin is linked to the first organization.
      afterCreated: async (userId) => {
        const organizations = getOrganizationService();
        const organization = await organizations.getMainOrganization();
        if (organization) await organizations.assignOrganizationAdmin({ organizationId: organization.id, userId, assignedBy: null });
      },
      beforeCredentials: async () => {
        const organizations = getOrganizationService();
        const created = await runOrganizationStep({ prompter, organizations, describeCode, out, err });
        if (created !== EXIT_OK) return created;
        const country = await runOrganizationCountryStep({ prompter, yes: false, organizations, geography: getGeographyService(), describeCode, out, err });
        if (country !== EXIT_OK) out('The Main Organization country was not assigned. Run npm run seed:geography, then npm run bootstrap:organization.');
        return EXIT_OK;
      },
    });
  } finally {
    prompter.close();
    await closeDatabase();
  }
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(`Bootstrap failed (${error instanceof Error ? error.name : 'UnknownError'}).`);
    process.exit(EXIT_FAILED);
  },
);
