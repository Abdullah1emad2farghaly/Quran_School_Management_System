import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { IMPORT_QURAN_USAGE, runImportQuranCli } from '../../../src/app/cli/import-quran-structure-cli';
import { QuranErrorCodes, quranError } from '../../../src/modules/21-quran-structure/public';
import { buildSyntheticDataset } from '../../helpers/quran-fixture';
import { createQuranHarness, validateSynthetic } from '../../helpers/quran-service-harness';

const file = Buffer.from(JSON.stringify(buildSyntheticDataset()), 'utf8');
const sha = createHash('sha256').update(file).digest('hex');

function run(args: string[], overrides: Partial<Parameters<typeof runImportQuranCli>[0]> = {}) {
  const t = createQuranHarness();
  const out: string[] = [];
  const err: string[] = [];
  let importerBuilt = 0;
  const code = runImportQuranCli({
    args,
    readFile: async (p) => (p === 'quran.json' ? file : Promise.reject(new Error('ENOENT'))),
    getImporter: () => {
      importerBuilt += 1;
      return t.importer;
    },
    validate: validateSynthetic,
    describeCode: (c) => (c === QuranErrorCodes.QURAN_DATASET_REPLACEMENT_NOT_CONFIRMED ? 'Not confirmed.' : undefined),
    out: (l) => out.push(l),
    err: (l) => err.push(l),
    ...overrides,
  });
  return code.then((exit) => ({ exit, out, err, t, importerBuilt }));
}

describe('import:quran CLI', () => {
  it('imports a valid file, reporting the counts, the source and the SHA-256 (exit 0)', async () => {
    const r = await run(['quran.json']);
    expect(r.exit).toBe(0);
    expect(r.out.join('\n')).toContain('Imported SYNTHETIC_TEST_EDITION: 114 surahs, 6236 ayahs, 604 pages');
    expect(r.out.join('\n')).toContain(sha);
    expect((await r.t.repository.findActiveImport())!.checksum).toBe(sha);
  });

  it('--dry-run validates without building the importer (no database)', async () => {
    const r = await run(['quran.json', '--dry-run']);
    expect(r.exit).toBe(0);
    expect(r.importerBuilt).toBe(0);
    expect(r.out.join('\n')).toContain('the dataset is VALID');
    expect(r.out.join('\n')).toContain('Juz evidence:');
    expect(r.out.join('\n')).toContain('The database was not touched');
    expect(await r.t.repository.findActiveImport()).toBeUndefined();
  });

  it('refuses a different dataset without --replace (exit 1, a hint, nothing changed) and accepts it with --replace', async () => {
    const t = createQuranHarness();
    await t.importSynthetic({ checksum: 'c'.repeat(64) });
    const refused = await run(['quran.json'], { getImporter: () => t.importer });
    expect(refused.exit).toBe(1);
    expect(refused.err.join('\n')).toContain('QURAN_DATASET_REPLACEMENT_NOT_CONFIRMED');
    expect(refused.err.join('\n')).toContain('--replace');
    expect((await t.repository.findActiveImport())!.checksum).toBe('c'.repeat(64));
    const replaced = await run(['quran.json', '--replace'], { getImporter: () => t.importer });
    expect(replaced.exit).toBe(0);
    expect(replaced.out.join('\n')).toContain('Replaced the active dataset');
    expect((await t.repository.findActiveImport())!.checksum).toBe(sha);
  });

  it('is idempotent: running the same file twice says so', async () => {
    const t = createQuranHarness();
    await run(['quran.json'], { getImporter: () => t.importer });
    const again = await run(['quran.json'], { getImporter: () => t.importer });
    expect(again.exit).toBe(0);
    expect(again.out.join('\n')).toContain('Already imported');
    expect(t.repository.imports).toHaveLength(1);
  });

  it('rejects an invalid dataset listing the problems, and changes nothing (exit 1)', async () => {
    const broken = JSON.parse(file.toString()) as Record<string, any>;
    broken.lines.splice(50, 2);
    const r = await run(['broken.json'], { readFile: async () => Buffer.from(JSON.stringify(broken)) });
    expect(r.exit).toBe(1);
    expect(r.err[0]).toContain('REJECTED');
    expect(r.err.length).toBeGreaterThan(1);
    expect(await r.t.repository.findActiveImport()).toBeUndefined();
  });

  it('fails cleanly on an unreadable file, invalid JSON and bad usage', async () => {
    expect((await run(['missing.json'])).exit).toBe(1);
    const notJson = await run(['x.json'], { readFile: async () => Buffer.from('{oops') });
    expect(notJson.exit).toBe(1);
    expect(notJson.err.join('\n')).toContain('not valid JSON');
    for (const args of [[], ['a.json', 'b.json'], ['quran.json', '--force']]) {
      const r = await run(args);
      expect(r.exit).toBe(2);
      expect(r.err).toEqual([IMPORT_QURAN_USAGE]);
    }
  });

  it('reports a failing database without leaking details', async () => {
    const r = await run(['quran.json'], { getImporter: () => ({ execute: async () => { throw new Error('ER_SECRET detail'); } }) });
    expect(r.exit).toBe(1);
    expect(r.err.join('\n')).toContain('Unexpected error (Error)');
    expect(r.err.join('\n')).not.toContain('ER_SECRET');
    expect(quranError('QURAN_DATASET_NOT_IMPORTED').code).toBe('QURAN_DATASET_NOT_IMPORTED');
  });
});
