import { describe, expect, it } from 'vitest';
import { CONVERT_QURAN_USAGE, runConvertQuranCli } from '../../../src/app/cli/convert-kfgqpc-hafs-cli';
import { APPROVED_KFGQPC_HAFS_PACKAGES } from '../../../src/modules/21-quran-structure/public';
import { buildSyntheticPackage } from '../../helpers/quran-fixture';

const pkg = buildSyntheticPackage();

function run(args: string[], files: Record<string, Buffer> = { 'a.zip': pkg.zip, 'q.xml': pkg.tanzil }) {
  const out: string[] = [];
  const err: string[] = [];
  const written: Record<string, string> = {};
  const code = runConvertQuranCli({
    args,
    readFile: async (p) => files[p] ?? Promise.reject(new Error('ENOENT')),
    writeFile: async (p, c) => void (written[p] = c),
    out: (l) => out.push(l),
    err: (l) => err.push(l),
  });
  return code.then((exit) => ({ exit, out, err, written }));
}

describe('convert:quran CLI', () => {
  it('refuses a package or a quarter file that is not an approved one and writes nothing (the synthetic ones are not approved)', async () => {
    const r = await run(['a.zip', 'q.xml', 'out.json']);
    expect(r.exit).toBe(1);
    expect(r.err.join('\n')).toContain('is not an approved');
    expect(r.written).toEqual({});
    expect(APPROVED_KFGQPC_HAFS_PACKAGES).toHaveLength(1);
  });

  it('fails cleanly on an unreadable input and on bad usage, writing nothing', async () => {
    const missing = await run(['missing.zip', 'q.xml', 'out.json']);
    expect(missing.exit).toBe(1);
    expect(missing.err.join('\n')).toContain('could not be read');
    for (const args of [[], ['a.zip', 'out.json'], ['a.zip', 'q.xml', 'out.json', 'extra'], ['a.zip', 'q.xml', '--force']]) {
      const r = await run(args);
      expect([r.exit, r.err, r.written]).toEqual([2, [CONVERT_QURAN_USAGE], {}]);
    }
  });
});
