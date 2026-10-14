/**
 * One-time, idempotent CLI: ensures the Main Organization exists (V1 allows exactly one), then assigns its country
 * (Egypt, `CNT-000001`; immutable once assigned). Safe to re-run. Use it on an installation whose Main Admin already
 * exists. Run `npm run db:migrate` and `npm run seed:geography` before.
 *   npm run bootstrap:organization            asks for a confirmation before assigning the country
 *   npm run bootstrap:organization -- --yes   skips ONLY that confirmation (all safety checks still run)
 */
import { closeDatabase } from '../../config/database';
import { getGeographyService } from '../../config/geography';
import { getOrganizationService } from '../../config/organization';
import { defaultMessageCatalog } from '../../modules/03-error-localization/public';
import { registerAllErrorMessages } from '../bootstrap/register-error-messages';
import { EXIT_FAILED, EXIT_OK, EXIT_USAGE } from './bootstrap-main-admin-cli';
import { parseOrganizationArgs, runOrganizationCountryStep, runOrganizationStep } from './bootstrap-organization-cli';
import { TerminalPrompter } from './terminal-prompter';

async function main(): Promise<number> {
  const args = parseOrganizationArgs(process.argv.slice(2));
  if ('error' in args) {
    console.error(args.error);
    return EXIT_USAGE;
  }
  registerAllErrorMessages();
  const prompter = new TerminalPrompter();
  try {
    const describeCode = (code: string) => (defaultMessageCatalog.has(code) ? defaultMessageCatalog.message(code, 'en') : undefined);
    const out = (line: string) => console.log(line);
    const err = (line: string) => console.error(line);
    const organizations = getOrganizationService();
    const created = await runOrganizationStep({ prompter, organizations, describeCode, out, err });
    if (created !== EXIT_OK) return created;
    return await runOrganizationCountryStep({ prompter, yes: args.yes, organizations, geography: getGeographyService(), describeCode, out, err });
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
