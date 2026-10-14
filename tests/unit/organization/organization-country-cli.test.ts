import { describe, expect, it } from 'vitest';
import { AppError } from '../../../src/modules/00-shared-kernel/public';
import { EXIT_FAILED, EXIT_OK, EXIT_USAGE } from '../../../src/app/cli/bootstrap-main-admin-cli';
import { EGYPT_COUNTRY_CODE, parseOrganizationArgs, runOrganizationCountryStep } from '../../../src/app/cli/bootstrap-organization-cli';

const EGYPT_ID = '0b6f7e0e-2b6a-4a57-9a4e-6f1d2c3b4a51';
const FRANCE_ID = '5d1c8f3a-7c9b-4e21-8b0a-1a2b3c4d5e6f';
const egypt = { id: EGYPT_ID, level: 'COUNTRY', code: 'CNT-000001', name: 'مصر', status: 'ACTIVE', parentId: null, kind: null };
const france = { id: FRANCE_ID, level: 'COUNTRY', code: 'CNT-000002', name: 'France', status: 'ACTIVE', parentId: null, kind: null };

interface Options {
  org?: { code: string; countryId: string | null } | null;
  countries?: unknown[];
  yes?: boolean;
  interactive?: boolean;
  answer?: boolean;
  assign?: (id: unknown) => Promise<{ changed: boolean }>;
}
function run(options: Options = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const calls = { assign: [] as unknown[], confirm: 0 };
  const countries = (options.countries ?? [egypt]) as never[];
  const org = options.org === undefined ? { code: 'ORG-000001', countryId: null } : options.org;
  const done = runOrganizationCountryStep({
    prompter: { isInteractive: () => options.interactive ?? true, confirm: async () => (calls.confirm++, options.answer ?? true) },
    yes: options.yes ?? false,
    organizations: {
      getMainOrganization: async () => org as never,
      assignMainOrganizationCountry: async (id: unknown) => (calls.assign.push(id), (options.assign ?? (async () => ({ changed: true })))(id)) as never,
    },
    geography: {
      listCountries: async () => countries,
      getCountry: async (id: string) => (countries as { id: string }[]).find((c) => c.id === id) as never,
    },
    describeCode: (c) => (c === 'ORGANIZATION_COUNTRY_ALREADY_SET' ? 'The country is already set.' : undefined),
    out: (l) => out.push(l),
    err: (l) => err.push(l),
  });
  return { done, out, err, calls };
}

describe('parseOrganizationArgs', () => {
  it('accepts no arguments and --yes only', () => {
    expect(parseOrganizationArgs([])).toEqual({ yes: false });
    expect(parseOrganizationArgs(['--yes'])).toEqual({ yes: true });
    expect(parseOrganizationArgs(['--force'])).toHaveProperty('error');
    expect(parseOrganizationArgs(['--yes', 'extra'])).toHaveProperty('error');
  });
});

describe('organization country step', () => {
  it('resolves CNT-000001 to the countries primary key and stores THAT, after a confirmation', async () => {
    const r = run();
    expect(await r.done).toBe(EXIT_OK);
    expect(r.calls.confirm).toBe(1);
    expect(r.calls.assign).toEqual([EGYPT_ID]); // the id (UUID), never the code
    expect(r.calls.assign).not.toContain(EGYPT_COUNTRY_CODE);
    expect(r.out.join('\n')).toContain('country assigned: CNT-000001 (مصر)');
  });

  it('--yes skips only the confirmation: the same checks and the same assignment', async () => {
    const r = run({ yes: true, interactive: false });
    expect(await r.done).toBe(EXIT_OK);
    expect(r.calls.confirm).toBe(0);
    expect(r.calls.assign).toEqual([EGYPT_ID]);
  });

  it('a cancelled confirmation changes nothing and fails the step', async () => {
    const r = run({ answer: false });
    expect(await r.done).toBe(EXIT_FAILED);
    expect(r.calls.assign).toEqual([]);
    expect(r.err.join('\n')).toContain('Nothing changed');
  });

  it('needs an interactive terminal or --yes', async () => {
    const r = run({ interactive: false });
    expect(await r.done).toBe(EXIT_USAGE);
    expect(r.calls.assign).toEqual([]);
  });

  it('is repeatable: an organization already in Egypt is only reported', async () => {
    const r = run({ org: { code: 'ORG-000001', countryId: EGYPT_ID }, interactive: false });
    expect(await r.done).toBe(EXIT_OK);
    expect(r.calls.assign).toEqual([]);
    expect(r.out.join('\n')).toContain('already CNT-000001');
  });

  it('never overwrites a different existing country: reports the conflict and stops (also with --yes)', async () => {
    const r = run({ org: { code: 'ORG-000001', countryId: FRANCE_ID }, countries: [egypt, france], yes: true });
    expect(await r.done).toBe(EXIT_FAILED);
    expect(r.calls.assign).toEqual([]);
    expect(r.err.join('\n')).toContain('CONFLICT');
  });

  it('stops when the existing country record is missing', async () => {
    const r = run({ org: { code: 'ORG-000001', countryId: FRANCE_ID }, countries: [egypt], yes: true });
    expect(await r.done).toBe(EXIT_FAILED);
    expect(r.calls.assign).toEqual([]);
  });

  it('stops, with --yes too, when the organization is missing', async () => {
    const r = run({ org: null, yes: true });
    expect(await r.done).toBe(EXIT_FAILED);
    expect(r.calls.assign).toEqual([]);
  });

  it('stops, with --yes too, when CNT-000001 does not exist (geography not seeded)', async () => {
    const r = run({ countries: [], yes: true });
    expect(await r.done).toBe(EXIT_FAILED);
    expect(r.calls.assign).toEqual([]);
    expect(r.err.join('\n')).toContain('seed:geography');
  });

  it('stops, with --yes too, when CNT-000001 is not Egypt or is not ACTIVE', async () => {
    const renamed = run({ countries: [{ ...egypt, name: 'Egypt' }], yes: true });
    expect(await renamed.done).toBe(EXIT_FAILED);
    expect(renamed.calls.assign).toEqual([]);
    const inactive = run({ countries: [{ ...egypt, status: 'INACTIVE' }], yes: true });
    expect(await inactive.done).toBe(EXIT_FAILED);
    expect(inactive.calls.assign).toEqual([]);
  });

  it('reports an application error with its code and an unexpected one by name only', async () => {
    const known = run({ yes: true, assign: async () => Promise.reject(new AppError('ORGANIZATION_COUNTRY_ALREADY_SET', 'CONFLICT')) });
    expect(await known.done).toBe(EXIT_FAILED);
    expect(known.err.join('\n')).toContain('[ORGANIZATION_COUNTRY_ALREADY_SET] The country is already set.');
    const unknown = run({ yes: true, assign: async () => Promise.reject(new Error('ER_SECRET detail')) });
    expect(await unknown.done).toBe(EXIT_FAILED);
    expect(unknown.err.join('\n')).toContain('Unexpected error (Error)');
    expect(unknown.err.join('\n')).not.toContain('ER_SECRET');
  });
});
