import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SESSION_ERROR_MESSAGES, SessionErrorCodes } from '../../../src/modules/10-sessions-jwt/public';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? sourceFiles(full) : full.endsWith('.ts') ? [full] : [];
  });
}

describe('session error messages', () => {
  it('has Arabic and English text for every session error code', () => {
    for (const code of Object.values(SessionErrorCodes)) {
      const entry = SESSION_ERROR_MESSAGES.find((m) => m.code === code);
      expect(entry, code).toBeDefined();
      expect(entry!.message.ar.length).toBeGreaterThan(0);
      expect(entry!.message.en.length).toBeGreaterThan(0);
    }
  });
});

describe('Module 10 boundaries', () => {
  const root = path.resolve(__dirname, '../../../src/modules/10-sessions-jwt');
  const files = sourceFiles(root);
  const importsOf = (file: string) => [...readFileSync(file, 'utf8').matchAll(/from '([^']+)'/g)].map((m) => m[1]!);
  const all = files.flatMap((file) => importsOf(file).map((spec) => ({ file, spec })));

  it('imports other modules only through their public contract', () => {
    expect(all.filter(({ spec }) => /\/\d{2}-[a-z-]+\//.test(spec) && !/\/\d{2}-[a-z-]+\/public$/.test(spec))).toEqual([]);
  });

  it('depends only on lower-numbered modules (no circular dependency)', () => {
    const higher = all.filter(({ spec }) => {
      const m = /\/(\d{2})-[a-z-]+\/public$/.exec(spec);
      return m !== null && Number(m[1]) >= 10;
    });
    expect(higher).toEqual([]);
  });

  it('keeps frameworks out of the domain and application layers', () => {
    const inner = all.filter(({ file }) => /\/(domain|application)\//.test(file.split(path.sep).join('/')));
    const forbidden = inner.filter(({ spec }) => ['express', 'sequelize', 'jsonwebtoken', 'node:crypto', 'bcryptjs'].includes(spec));
    expect(forbidden).toEqual([]);
  });

  it('has no environment-based token lifetime (lifetimes are fixed by the specification)', () => {
    const offenders = files.filter((f) => /process\.env|JWT_.*(EXPIRES|TTL|LIFETIME)/i.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
