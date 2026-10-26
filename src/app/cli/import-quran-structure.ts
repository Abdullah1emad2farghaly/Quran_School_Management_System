/**
 * Imports the Quran structure dataset (Module 21). Repeatable and idempotent; see docs/QURAN-STRUCTURE.md for the file format.
 * Run `npm run db:migrate` first. `--dry-run` validates the file without a database.
 */
import { readFile } from 'node:fs/promises';
import { closeDatabase } from '../../config/database';
import { getImportQuranDataset } from '../../config/quran';
import { defaultMessageCatalog } from '../../modules/03-error-localization/public';
import { registerAllErrorMessages } from '../bootstrap/register-error-messages';
import { EXIT_FAILED } from './bootstrap-main-admin-cli';
import { runImportQuranCli } from './import-quran-structure-cli';

async function main(): Promise<number> {
  registerAllErrorMessages();
  try {
    return await runImportQuranCli({
      args: process.argv.slice(2),
      readFile: (path) => readFile(path),
      getImporter: getImportQuranDataset,
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
    console.error(`Import failed (${error instanceof Error ? error.name : 'UnknownError'}).`);
    process.exit(EXIT_FAILED);
  },
);
