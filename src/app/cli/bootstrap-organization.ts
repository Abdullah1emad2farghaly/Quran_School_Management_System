/**
 * One-time, idempotent CLI: ensures the Main Organization exists (V1 allows exactly one). Safe to re-run.
 * Use it on an installation whose Main Admin already exists; for a fresh install `npm run bootstrap:main-admin`
 * performs the same step first. Run `npm run db:migrate` before.
 */
import { closeDatabase } from '../../config/database';
import { getOrganizationService } from '../../config/organization';
import { defaultMessageCatalog } from '../../modules/03-error-localization/public';
import { registerAllErrorMessages } from '../bootstrap/register-error-messages';
import { EXIT_FAILED } from './bootstrap-main-admin-cli';
import { runOrganizationStep } from './bootstrap-organization-cli';
import { TerminalPrompter } from './terminal-prompter';

async function main(): Promise<number> {
  registerAllErrorMessages();
  const prompter = new TerminalPrompter();
  try {
    return await runOrganizationStep({
      prompter,
      organizations: getOrganizationService(),
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
