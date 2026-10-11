/**
 * Idempotent reference seed: Egypt and its 27 governorates (Master Specification §90). Safe to re-run. Does not add
 * centers, cities or villages. Run `npm run db:migrate` first.
 */
import { closeDatabase } from '../../config/database';
import { getSeedEgyptGeography } from '../../config/geography';
import { defaultMessageCatalog } from '../../modules/03-error-localization/public';
import { registerAllErrorMessages } from '../bootstrap/register-error-messages';
import { EXIT_FAILED } from './bootstrap-main-admin-cli';
import { runSeedGeographyCli } from './seed-geography-cli';

async function main(): Promise<number> {
  registerAllErrorMessages();
  try {
    return await runSeedGeographyCli({
      seeder: getSeedEgyptGeography(),
      describeCode: (code) => (defaultMessageCatalog.has(code) ? defaultMessageCatalog.message(code, 'en') : undefined),
      out: (line) => console.log(line),
      err: (line) => console.error(line),
    });
  } finally {
    await closeDatabase();
  }
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(`Seed failed (${error instanceof Error ? error.name : 'UnknownError'}).`);
    process.exit(EXIT_FAILED);
  },
);
