import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { UNIFIED_ADDRESS_ERROR_MESSAGES, UnifiedAddressErrorCodes } from '../../../src/modules/15-unified-address/public';
import { ORGANIZATION_ERROR_MESSAGES, OrganizationErrorCodes } from '../../../src/modules/13-organization-core/public';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? sourceFiles(full) : full.endsWith('.ts') ? [full] : [];
  });
}

describe('error messages', () => {
  it('has Arabic and English text for every Unified Address and Organization error code', () => {
    const cases: [readonly { code: string; message: { ar: string; en: string } }[], string[]][] = [
      [UNIFIED_ADDRESS_ERROR_MESSAGES, Object.values(UnifiedAddressErrorCodes)],
      [ORGANIZATION_ERROR_MESSAGES, Object.values(OrganizationErrorCodes)],
    ];
    for (const [messages, codes] of cases) {
      for (const code of codes) {
        const entry = messages.find((m) => m.code === code);
        expect(entry, code).toBeDefined();
        expect(entry!.message.ar.length).toBeGreaterThan(0);
        expect(entry!.message.en.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('Module 15 boundaries', () => {
  const root = path.resolve(__dirname, '../../../src/modules/15-unified-address');
  const files = sourceFiles(root);
  const all = files.flatMap((file) => [...readFileSync(file, 'utf8').matchAll(/from '([^']+)'/g)].map((m) => ({ file, spec: m[1]! })));

  it('imports other modules only through their public contract', () => {
    expect(all.filter(({ spec }) => /\/\d{2}-[a-z-]+\//.test(spec) && !/\/\d{2}-[a-z-]+\/public$/.test(spec))).toEqual([]);
  });

  it('depends only on lower-numbered modules (no circular dependency)', () => {
    const higher = all.filter(({ spec }) => {
      const m = /\/(\d{2})-[a-z-]+\/public$/.exec(spec);
      return m !== null && Number(m[1]) >= 15;
    });
    expect(higher).toEqual([]);
  });

  it('owns no persistence, framework or environment access: pure application logic', () => {
    const forbidden = all.filter(({ spec }) => ['express', 'sequelize', 'node:crypto', 'node:fs'].includes(spec));
    expect(forbidden).toEqual([]);
    expect(files.filter((f) => /process\.env/.test(readFileSync(f, 'utf8')))).toEqual([]);
    expect(files.filter((f) => /\/(infrastructure|presentation)\//.test(f.split(path.sep).join('/')))).toEqual([]);
  });

  it('uses the structured hierarchy check only for the ORGANIZATION address; school and parent rules are separate', () => {
    const users = files.filter((f) => /validateHierarchy/.test(readFileSync(f, 'utf8').replace(/\/\/.*|\/\*[\s\S]*?\*\//g, '')));
    expect(users.map((f) => path.basename(f))).toEqual(['unified-address-service.ts']);
    expect(readFileSync(users[0]!, 'utf8')).toMatch(/validateOrganizationAddress/);
  });

  it('has no migration and no table of its own', () => {
    const migrations = readdirSync(path.resolve(__dirname, '../../../database/migrations'));
    expect(migrations.filter((m) => /address/i.test(m))).toEqual([]);
  });
});
