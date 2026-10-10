/**
 * One-time CLI: ensures the Main Organization exists (Module 13, idempotent), then creates the FIRST Main Admin
 * (there is no registration endpoint). Run `npm run db:migrate` first, then
 * `npm run bootstrap:main-admin` in an interactive terminal. Refuses when an active Main Admin already exists.
 */
import { closeDatabase } from '../../config/database';
import { getBootstrapMainAdmin } from '../../config/authorization';
import { getOrganizationService } from '../../config/organization';
import { defaultMessageCatalog } from '../../modules/03-error-localization/public';
import { registerAllErrorMessages } from '../bootstrap/register-error-messages';
import { EXIT_FAILED, runBootstrapMainAdminCli } from './bootstrap-main-admin-cli';
import { runOrganizationStep } from './bootstrap-organization-cli';
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
      // The Main Organization is ensured first (idempotent: an existing one is only reported).
      beforeCredentials: () => runOrganizationStep({ prompter, organizations: getOrganizationService(), describeCode, out, err }),
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
