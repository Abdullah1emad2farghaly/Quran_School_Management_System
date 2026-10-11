import { describe, expect, it } from 'vitest';
import { AppError } from '../../../src/modules/00-shared-kernel/public';
import { EXIT_FAILED, EXIT_OK } from '../../../src/app/cli/bootstrap-main-admin-cli';
import { runSeedGeographyCli } from '../../../src/app/cli/seed-geography-cli';

const run = (execute: () => Promise<unknown>) => {
  const out: string[] = [];
  const err: string[] = [];
  const done = runSeedGeographyCli({ seeder: { execute: execute as never }, out: (l) => out.push(l), err: (l) => err.push(l), describeCode: () => 'text' });
  return { done, out, err };
};

describe('seed geography CLI', () => {
  it('reports the counts and states that the dataset is not complete', async () => {
    const r = run(async () => ({ country: { code: 'CNT-000001', created: true }, governorates: { total: 27, created: 27, existing: 0 } }));
    expect(await r.done).toBe(EXIT_OK);
    const text = r.out.join('\n');
    expect(text).toContain('CNT-000001 (created)');
    expect(text).toContain('27 created, 0 already existed');
    expect(text).toContain('NOT included');
    expect(text).toContain('not a complete geography dataset');
  });

  it('reports a re-run as already existing (idempotent)', async () => {
    const r = run(async () => ({ country: { code: 'CNT-000001', created: false }, governorates: { total: 27, created: 0, existing: 27 } }));
    expect(await r.done).toBe(EXIT_OK);
    expect(r.out.join('\n')).toContain('already existed');
  });

  it('prints the code for known errors and only the error name for unexpected ones', async () => {
    const known = run(async () => Promise.reject(new AppError('GEOGRAPHY_NODE_ALREADY_EXISTS', 'CONFLICT')));
    expect(await known.done).toBe(EXIT_FAILED);
    expect(known.err.join('\n')).toContain('[GEOGRAPHY_NODE_ALREADY_EXISTS] text');
    const unknown = run(async () => Promise.reject(new Error('ER_SECRET')));
    expect(await unknown.done).toBe(EXIT_FAILED);
    expect(unknown.err.join('\n')).toContain('Unexpected error (Error)');
    expect(unknown.err.join('\n')).not.toContain('ER_SECRET');
  });
});
