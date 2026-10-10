/**
 * One-time CLI: creates the FIRST Main Admin (there is no registration endpoint). Run `npm run db:migrate` first, then
 * `npm run bootstrap:main-admin` in an interactive terminal. Refuses when an active Main Admin already exists.
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
    return await runBootstrapMainAdminCli({
      prompter,
      bootstrap: getBootstrapMainAdmin(),
      describeCode: (code) => (defaultMessageCatalog.has(code) ? defaultMessageCatalog.message(code, 'en') : undefined),
      out: (line) => console.log(line),
      err: (line) => console.error(line),
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
