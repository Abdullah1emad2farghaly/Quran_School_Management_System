/**
 * One-time CLI: creates the FIRST Main Admin, the platform-wide administrator (there is no registration endpoint). It is
 * platform-level and independent of any organization: it creates no organization and links the administrator to none.
 * Run `npm run db:migrate` first, then `npm run bootstrap:main-admin` in an interactive terminal. Refuses when an active
 * Main Admin already exists. Organizations are created by their own registration workflow (POST /api/v1/organizations).
 */
import { closeDatabase } from '../../config/database';
import { getBootstrapMainAdmin } from '../../config/authorization';
import { defaultMessageCatalog } from '../../modules/03-error-localization/public';
import { registerAllErrorMessages } from '../bootstrap/register-error-messages';
import { EXIT_FAILED, runBootstrapMainAdminCli } from './bootstrap-main-admin-cli';
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
