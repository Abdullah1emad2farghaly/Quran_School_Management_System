import { QuranDatasetValidationError } from '../../domain/errors/quran-errors';
import { SURAH_AYAH_COUNTS } from '../../domain/value-objects/quran-edition';

/** The approved quarter source (project owner decision): the supplied Tanzil `quran-data.xml`, pinned by SHA-256. A different file is refused until it is added here deliberately. */
export const APPROVED_TANZIL_QUARTER_FILES: ReadonlyArray<{ readonly fileName: string; readonly sha256: string }> = Object.freeze([
  { fileName: 'quran-data.xml', sha256: '8867c1d88191472adec9db694b3cd9f135b1a2ef580574d32cf888dcb22c5c7a' },
]);

export interface TanzilQuarter {
  readonly index: number;
  readonly surah: number;
  readonly ayah: number;
}
export interface TanzilQuarterFile {
  readonly quarters: readonly TanzilQuarter[];
  /** The attributes the file states on its root element (version, copyright, license). */
  readonly meta: { readonly version: string | null; readonly copyright: string | null; readonly license: string | null };
}

const attribute = (tag: string, name: string): string | undefined => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];

/**
 * Reads the quarter records (<hizbs><quarter index sura aya/>) of a Tanzil `quran-data.xml` AS THEY ARE: no value is corrected, reordered or completed.
 * It rejects (listing every problem) a file whose quarter section is missing, whose indexes are not 1..N without gaps or repeats and in file order,
 * whose references are not real ayahs of the Hafs count, or whose positions do not strictly increase. The number of records must be that of the file
 * itself; that it is 240 is checked against the structure of the Quran by the dataset validator, not assumed here.
 */
export function readTanzilQuarters(xml: string): TanzilQuarterFile {
  const problems: string[] = [];
  const root = /<quran\b[^>]*>/.exec(xml)?.[0];
  if (root === undefined) throw new QuranDatasetValidationError(['The Tanzil file has no <quran> root element.']);
  const section = /<hizbs\b[^>]*>([\s\S]*?)<\/hizbs>/.exec(xml)?.[1];
  if (section === undefined) throw new QuranDatasetValidationError(['The Tanzil file has no <hizbs> (quarter) section.']);
  const quarters: TanzilQuarter[] = [];
  const seen = new Set<number>();
  let previousIndex = 0;
  let previousGlobal = 0;
  for (const m of section.matchAll(/<quarter\b([^>]*?)\/?>/g)) {
    const tag = m[1]!;
    const index = Number(attribute(tag, 'index'));
    const surah = Number(attribute(tag, 'sura'));
    const ayah = Number(attribute(tag, 'aya'));
    const where = `quarter record ${quarters.length + 1}`;
    if (![index, surah, ayah].every((v) => Number.isInteger(v))) {
      problems.push(`${where} needs integer "index", "sura" and "aya" attributes.`);
      continue;
    }
    if (seen.has(index)) problems.push(`${where}: quarter index ${index} appears more than once.`);
    seen.add(index);
    if (index !== previousIndex + 1) problems.push(`${where}: quarter index ${index} follows ${previousIndex} (indexes must be 1..N in file order, none missing).`);
    previousIndex = index;
    if (surah < 1 || surah > 114 || ayah < 1 || ayah > SURAH_AYAH_COUNTS[surah - 1]!) {
      problems.push(`quarter ${index}: ${surah}:${ayah} is not an ayah of the Hafs count.`);
      continue;
    }
    const global = SURAH_AYAH_COUNTS.slice(0, surah - 1).reduce((a, b) => a + b, 0) + ayah;
    if (global <= previousGlobal) problems.push(`quarter ${index}: ${surah}:${ayah} does not come after the previous quarter.`);
    previousGlobal = global;
    quarters.push({ index, surah, ayah });
  }
  if (quarters.length === 0 && problems.length === 0) problems.push('The Tanzil quarter section holds no <quarter> records.');
  if (problems.length > 0) throw new QuranDatasetValidationError(problems.slice(0, 50), problems.length);
  return { quarters, meta: { version: attribute(root, 'version') ?? null, copyright: attribute(root, 'copyright') ?? null, license: attribute(root, 'license') ?? null } };
}
