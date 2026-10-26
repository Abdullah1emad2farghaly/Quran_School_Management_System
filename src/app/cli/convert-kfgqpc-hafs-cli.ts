import { QuranDatasetValidationError, convertKfgqpcHafsPackage, serializeDataset, validateQuranDataset, type ConversionReport } from '../../modules/21-quran-structure/public';
import { EXIT_FAILED, EXIT_OK, EXIT_USAGE } from './bootstrap-main-admin-cli';

export const CONVERT_QURAN_USAGE = 'Usage: npm run convert:quran -- <kfgqpc_hafs_v30.zip> <quran-data.xml> <output.json>';

export interface ConvertQuranCliDeps {
  readonly args: readonly string[];
  readonly readFile: (path: string) => Promise<Buffer>;
  readonly writeFile: (path: string, content: string) => Promise<void>;
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
}

function printReport(report: ConversionReport, out: (line: string) => void): void {
  out(`Package ${report.packageVersion}, SHA-256 ${report.packageSha256}`);
  out(`Counts: ${JSON.stringify(report.counts)}`);
  for (const [check, result] of Object.entries(report.crossChecks)) out(`  ${result.startsWith('passed') ? 'OK ' : '?? '} ${check}: ${result}`);
  out('Juz starts (the official KFGQPC Excel "jozz" values, used as stated) and, informationally, their relation to the markers printed in the text:');
  for (const j of report.juz) {
    const near = j.nearestMarkerBefore || j.nearestMarkerAfter ? `  (printed marker positions, for information) before: ${j.nearestMarkerBefore ? `${j.nearestMarkerBefore.surah}:${j.nearestMarkerBefore.ayah}` : 'none'}, after: ${j.nearestMarkerAfter ? `${j.nearestMarkerAfter.surah}:${j.nearestMarkerAfter.ayah}` : 'none'}` : '';
    out(`  juz ${String(j.juz).padStart(2)}  ${j.start.surah}:${j.start.ayah}  page ${j.page} line ${j.line}  ${j.verification}${near}`);
  }
}

/**
 * `npm run convert:quran -- <kfgqpc_hafs_v30.zip> <quran-data.xml> <output.json>`: converts the approved sources (the official KFGQPC package for the text,
 * layout and juz; the approved Tanzil file for the 240 quarters) into the normalized dataset, validates the result with the project validator and writes it.
 * Deterministic. The inputs are only read (never modified); nothing touches the database.
 * Exit codes: 0 ok, 1 refused or failed (nothing written), 2 usage.
 */
export async function runConvertQuranCli(deps: ConvertQuranCliDeps): Promise<number> {
  if (deps.args.length !== 3 || deps.args.some((a) => a.startsWith('--'))) {
    deps.err(CONVERT_QURAN_USAGE);
    return EXIT_USAGE;
  }
  const [input, quarterFile, output] = deps.args as [string, string, string];
  let bytes: Buffer;
  let quarterBytes: Buffer;
  try {
    bytes = await deps.readFile(input);
    quarterBytes = await deps.readFile(quarterFile);
  } catch {
    deps.err('An input file could not be read. Nothing was written.');
    return EXIT_FAILED;
  }
  try {
    const { dataset, report } = convertKfgqpcHafsPackage(bytes, quarterBytes);
    validateQuranDataset(dataset); // the converted dataset must pass the same validation as an import
    await deps.writeFile(output, serializeDataset(dataset));
    printReport(report, deps.out);
    deps.out(`Written ${output}. Validate it with: npm run import:quran -- ${output} --dry-run`);
    return EXIT_OK;
  } catch (error) {
    if (error instanceof QuranDatasetValidationError) {
      deps.err(`The package was REJECTED (${error.totalProblems} problem${error.totalProblems === 1 ? '' : 's'}); nothing was written.`);
      for (const problem of error.problems) deps.err(`  - ${problem}`);
    } else deps.err(`The package could not be converted (${error instanceof Error ? error.message : 'unknown error'}). Nothing was written.`);
    return EXIT_FAILED;
  }
}
