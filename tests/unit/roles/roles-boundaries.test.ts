import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? sourceFiles(full) : full.endsWith('.ts') ? [full] : [];
  });
}

describe('Module 09 boundaries', () => {
  const root = path.resolve(__dirname, '../../../src/modules/09-roles-permissions');
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
      return m !== null && Number(m[1]) >= 9;
    });
    expect(higher).toEqual([]);
  });

  it('exposes no HTTP routes (authorization of role changes belongs to Modules 10/12)', () => {
    expect(sourceFiles(path.join(root, 'presentation'))).toEqual([]);
  });
});
