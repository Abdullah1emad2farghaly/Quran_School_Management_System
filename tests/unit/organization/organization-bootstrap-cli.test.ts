import { describe, expect, it } from 'vitest';
import { AppError } from '../../../src/modules/00-shared-kernel/public';
import { runBootstrapMainAdminCli, EXIT_FAILED, EXIT_OK, EXIT_USAGE } from '../../../src/app/cli/bootstrap-main-admin-cli';
import { runOrganizationStep } from '../../../src/app/cli/bootstrap-organization-cli';

function org(options: { existing?: boolean; interactive?: boolean; ensure?: () => Promise<{ organization: { code: string }; created: boolean }> } = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const calls = { ensure: 0, ask: 0 };
  const done = runOrganizationStep({
    prompter: {
      isInteractive: () => options.interactive ?? true,
      askOrganizationName: async () => (calls.ask++, 'Al-Noor'),
    },
    organizations: {
      getMainOrganization: async () => (options.existing ? ({ code: 'ORG-000001' } as never) : undefined),
      ensureMainOrganization: async () => (calls.ensure++, (options.ensure ?? (async () => ({ organization: { code: 'ORG-000001' }, created: true })))() as never),
    },
    describeCode: (c) => (c === 'INVALID_ORGANIZATION_NAME' ? 'The organization name is required.' : undefined),
    out: (l) => out.push(l),
    err: (l) => err.push(l),
  });
  return { done, out, err, calls };
}

describe('organization bootstrap step', () => {
  it('creates the organization and prints its code', async () => {
    const r = org();
    expect(await r.done).toBe(EXIT_OK);
    expect(r.out.join('\n')).toContain('Main Organization created. Code: ORG-000001');
    expect(r.calls).toEqual({ ensure: 1, ask: 1 });
  });

  it('is idempotent: an existing organization is only reported (no prompt, no create, works non-interactively)', async () => {
    const r = org({ existing: true, interactive: false });
    expect(await r.done).toBe(EXIT_OK);
    expect(r.out.join('\n')).toContain('already exists (ORG-000001). Nothing changed.');
    expect(r.calls).toEqual({ ensure: 0, ask: 0 });
  });

  it('needs an interactive terminal only when it has to ask', async () => {
    const r = org({ interactive: false });
    expect(await r.done).toBe(EXIT_USAGE);
    expect(r.calls.ensure).toBe(0);
  });

  it('reports a validation error with its code', async () => {
    const r = org({ ensure: async () => Promise.reject(new AppError('INVALID_ORGANIZATION_NAME', 'VALIDATION')) });
    expect(await r.done).toBe(EXIT_FAILED);
    expect(r.err.join('\n')).toContain('[INVALID_ORGANIZATION_NAME] The organization name is required.');
  });

  it('prints only the error name for unexpected failures', async () => {
    const r = org({ ensure: async () => Promise.reject(new Error('ER_SECRET detail')) });
    expect(await r.done).toBe(EXIT_FAILED);
    expect(r.err.join('\n')).toContain('Unexpected error (Error)');
    expect(r.err.join('\n')).not.toContain('ER_SECRET');
  });
});

describe('Main Admin CLI runs the organization step first', () => {
  const base = (beforeCredentials: () => Promise<number>) => {
    let executed = 0;
    const done = runBootstrapMainAdminCli({
      prompter: { isInteractive: () => true, askPhone: async () => '01012345678', askPassword: async () => 'Sup3r-Secret' },
      bootstrap: { execute: async () => (executed++, { userId: 'user-1' }) },
      out: () => undefined,
      err: () => undefined,
      beforeCredentials,
    });
    return { done, executed: () => executed };
  };

  it('continues to create the Main Admin when the organization step succeeds', async () => {
    const r = base(async () => EXIT_OK);
    expect(await r.done).toBe(EXIT_OK);
    expect(r.executed()).toBe(1);
  });

  it('creates no Main Admin when the organization step fails', async () => {
    const r = base(async () => EXIT_FAILED);
    expect(await r.done).toBe(EXIT_FAILED);
    expect(r.executed()).toBe(0);
  });
});
