import { describe, expect, it } from 'vitest';
import { AppError } from '../../../src/modules/00-shared-kernel/public';
import {
  EXIT_FAILED,
  EXIT_OK,
  EXIT_USAGE,
  runBootstrapMainAdminCli,
  type CredentialPrompter,
} from '../../../src/app/cli/bootstrap-main-admin-cli';

const PASSWORD = 'Sup3r-Secret';
function run(options: { interactive?: boolean; confirm?: string; execute?: () => Promise<{ userId: string }> } = {}) {
  const out: string[] = [];
  const err: string[] = [];
  let calls = 0;
  const answers = [PASSWORD, options.confirm ?? PASSWORD];
  const prompter: CredentialPrompter = {
    isInteractive: () => options.interactive ?? true,
    askPhone: async () => '01012345678',
    askPassword: async () => answers.shift() as string,
  };
  const exec = options.execute ?? (async () => ({ userId: 'user-1' }));
  const done = runBootstrapMainAdminCli({
    prompter,
    bootstrap: { execute: async () => (calls++, exec()) },
    describeCode: (code) => (code === 'MAIN_ADMIN_ALREADY_EXISTS' ? 'An active Main Admin already exists.' : undefined),
    out: (l) => out.push(l),
    err: (l) => err.push(l),
  });
  return { done, out, err, calls: () => calls };
}

describe('bootstrap CLI', () => {
  it('creates the Main Admin and prints the user id but never the phone or password', async () => {
    const r = run();
    expect(await r.done).toBe(EXIT_OK);
    const all = [...r.out, ...r.err].join('\n');
    expect(all).toContain('user-1');
    expect(all).not.toContain(PASSWORD);
    expect(all).not.toContain('01012345678');
  });

  it('refuses without an interactive terminal and does nothing', async () => {
    const r = run({ interactive: false });
    expect(await r.done).toBe(EXIT_USAGE);
    expect(r.calls()).toBe(0);
  });

  it('aborts when the confirmation differs, without calling the use case or echoing passwords', async () => {
    const r = run({ confirm: 'different' });
    expect(await r.done).toBe(EXIT_FAILED);
    expect(r.calls()).toBe(0);
    expect([...r.out, ...r.err].join('\n')).not.toContain(PASSWORD);
  });

  it('reports a refusal with its code and exit code 1', async () => {
    const r = run({ execute: async () => Promise.reject(new AppError('MAIN_ADMIN_ALREADY_EXISTS', 'CONFLICT')) });
    expect(await r.done).toBe(EXIT_FAILED);
    expect(r.err.join('\n')).toContain('[MAIN_ADMIN_ALREADY_EXISTS] An active Main Admin already exists.');
    expect(r.err.join('\n')).toContain('Nothing was created');
  });

  it('prints only the error name for unexpected failures (no message, no secrets)', async () => {
    const r = run({ execute: async () => Promise.reject(new Error(`ER_ACCESS_DENIED password=${PASSWORD}`)) });
    expect(await r.done).toBe(EXIT_FAILED);
    const all = [...r.out, ...r.err].join('\n');
    expect(all).toContain('Unexpected error (Error)');
    expect(all).not.toContain(PASSWORD);
    expect(all).not.toContain('ER_ACCESS_DENIED');
  });
});
