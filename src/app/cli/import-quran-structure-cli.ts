import { createHash } from 'node:crypto';
import { AppError } from '../../modules/00-shared-kernel/public';
import { QuranDatasetValidationError, validateQuranDataset, type ImportQuranDataset, type ValidatedQuranDataset } from '../../modules/21-quran-structure/public';
import { EXIT_FAILED, EXIT_OK, EXIT_USAGE } from './bootstrap-main-admin-cli';

export const IMPORT_QURAN_USAGE = 'Usage: npm run import:quran -- <dataset.json> [--dry-run] [--replace]';

export interface ImportQuranCliDeps {
  readonly args: readonly string[];
  readonly readFile: (path: string) => Promise<Buffer>;
  /** Built lazily: `--dry-run` never touches the database. */
  readonly getImporter: () => Pick<ImportQuranDataset, 'execute'>;
  readonly validate?: (raw: unknown) => ValidatedQuranDataset;
  readonly describeCode?: (code: string) => string | undefined;
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
}

/**
 * `npm run import:quran -- <file> [--dry-run] [--replace]`. No prompts, repeatable and idempotent.
 *  --dry-run  validates the file completely and reports; the database is not touched.
 *  --replace  allows a DIFFERENT dataset to replace the active one (otherwise the import refuses and nothing changes).
 * Exit codes: 0 ok (imported, replaced, unchanged, or a valid dry run), 1 failed (nothing changed), 2 usage.
 */
export async function runImportQuranCli(deps: ImportQuranCliDeps): Promise<number> {
  const flags = deps.args.filter((a) => a.startsWith('--'));
  const files = deps.args.filter((a) => !a.startsWith('--'));
  const unknown = flags.filter((f) => f !== '--dry-run' && f !== '--replace');
  if (files.length !== 1 || unknown.length > 0) {
    deps.err(IMPORT_QURAN_USAGE);
    return EXIT_USAGE;
  }
  const dryRun = flags.includes('--dry-run');
  const replace = flags.includes('--replace');

  let bytes: Buffer;
  try {
    bytes = await deps.readFile(files[0]!);
  } catch {
    deps.err(`The file "${files[0]}" could not be read. Nothing was changed.`);
    return EXIT_FAILED;
  }
  const checksum = createHash('sha256').update(bytes).digest('hex');
  let raw: unknown;
  try {
    raw = JSON.parse(bytes.toString('utf8'));
  } catch {
    deps.err('The file is not valid JSON. Nothing was changed.');
    return EXIT_FAILED;
  }

  try {
    if (dryRun) {
      const dataset = (deps.validate ?? validateQuranDataset)(raw);
      const conflicts = dataset.juzs.filter((j) => j.verification === 'MARKER_CONFLICT').length;
      deps.out(`Dry run: the dataset is VALID for ${dataset.editionCode} (${dataset.surahs.length} surahs, ${dataset.ayahs.length} ayahs with text, ${dataset.pages.length} pages, ${dataset.lines.length} lines, ${dataset.juzs.length} juz starts, ${dataset.quarterMarks.length} printed quarter markers).`);
      deps.out(`Juz evidence: ${dataset.juzs.filter((j) => j.verification === 'MARKER_CONFIRMED').length} confirmed by a printed marker, ${dataset.juzs.filter((j) => j.verification === 'SURAH_START_NO_MARKER').length} at a surah start (no marker possible), ${conflicts} in MARKER_CONFLICT (unresolved).`);
      deps.out(`Source: ${dataset.source.provider} / ${dataset.source.name}. SHA-256 ${checksum}. The database was not touched.`);
      return EXIT_OK;
    }
    const summary = await deps.getImporter().execute({ raw, checksum, replace }, deps.validate);
    const verb = { IMPORTED: 'Imported', REPLACED: 'Replaced the active dataset with', UNCHANGED: 'Already imported (identical file); nothing changed:' }[summary.outcome];
    deps.out(`${verb} ${summary.editionCode}: ${summary.counts.surahs} surahs, ${summary.counts.ayahs} ayahs, ${summary.counts.pages} pages, ${summary.counts.lines} lines, ${summary.counts.quarterMarks} printed quarter markers.`);
    deps.out(`Source: ${summary.source.provider} / ${summary.source.name}. SHA-256 ${summary.checksum}.`);
    return EXIT_OK;
  } catch (error) {
    if (error instanceof QuranDatasetValidationError) {
      deps.err(`The dataset was REJECTED (${error.totalProblems} problem${error.totalProblems === 1 ? '' : 's'}); nothing was changed.`);
      for (const problem of error.problems) deps.err(`  - ${problem}`);
      if (error.totalProblems > error.problems.length) deps.err(`  ... and ${error.totalProblems - error.problems.length} more.`);
    } else if (error instanceof AppError) {
      const text = deps.describeCode?.(error.code);
      deps.err(`The Quran dataset was not imported (nothing changed). [${error.code}]${text ? ` ${text}` : ''}${error.code === 'QURAN_DATASET_REPLACEMENT_NOT_CONFIRMED' ? ' Use --replace to replace it.' : ''}`);
    } else {
      deps.err(`The Quran dataset was not imported (nothing changed). Unexpected error (${error instanceof Error ? error.name : 'UnknownError'}); check that npm run db:migrate has been run.`);
    }
    return EXIT_FAILED;
  }
}
