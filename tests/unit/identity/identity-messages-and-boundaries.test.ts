import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { IDENTITY_ERROR_MESSAGES, IdentityErrorCodes } from '../../../src/modules/08-identity-core/public';

describe('identity error messages', () => {
  it('has Arabic and English text for every identity error code', () => {
    for (const code of Object.values(IdentityErrorCodes)) {
      const entry = IDENTITY_ERROR_MESSAGES.find((m) => m.code === code);
      expect(entry, code).toBeDefined();
      expect(entry!.message.ar.length, `${code} ar`).toBeGreaterThan(0);
      expect(entry!.message.en.length, `${code} en`).toBeGreaterThan(0);
    }
  });
});

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? sourceFiles(full) : full.endsWith('.ts') ? [full] : [];
  });
}

describe('Module 08 boundaries', () => {
  const root = path.resolve(__dirname, '../../../src/modules/08-identity-core');
  const imports = sourceFiles(root).flatMap((file) =>
    [...readFileSync(file, 'utf8').matchAll(/from '([^']+)'/g)].map((m) => ({ file, spec: m[1]! })),
  );

  it('imports other modules only through their public contract', () => {
    const offenders = imports.filter(({ spec }) => /\/\d{2}-[a-z-]+\//.test(spec) && !/\/\d{2}-[a-z-]+\/public$/.test(spec));
    expect(offenders).toEqual([]);
  });

  it('depends only on lower-numbered modules (no circular dependency)', () => {
    const higher = imports.filter(({ spec }) => {
      const m = /\/(\d{2})-[a-z-]+\/public$/.exec(spec);
      return m !== null && Number(m[1]) >= 8;
    });
    expect(higher).toEqual([]);
  });

  it('exposes no HTTP routes (there is no authentication/authorization yet)', () => {
    const presentation = sourceFiles(path.join(root, 'presentation'));
    expect(presentation).toEqual([]);
  });
});
