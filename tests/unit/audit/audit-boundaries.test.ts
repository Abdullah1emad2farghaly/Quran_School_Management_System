import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AUDIT_ERROR_MESSAGES, AuditErrorCodes } from '../../../src/modules/35-history-audit/public';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? sourceFiles(full) : full.endsWith('.ts') ? [full] : [];
  });
}

describe('audit error messages', () => {
  it('has Arabic and English text for every code', () => {
    for (const code of Object.values(AuditErrorCodes)) {
      const entry = AUDIT_ERROR_MESSAGES.find((m) => m.code === code);
      expect(entry?.message.ar.length).toBeGreaterThan(0);
      expect(entry?.message.en.length).toBeGreaterThan(0);
    }
  });
});

describe('Module 35 boundaries and immutability', () => {
  const root = path.resolve(__dirname, '../../../src/modules/35-history-audit');
  const files = sourceFiles(root);
  const importsOf = (file: string) => [...readFileSync(file, 'utf8').matchAll(/from '([^']+)'/g)].map((m) => m[1]!);
  const all = files.flatMap((file) => importsOf(file).map((spec) => ({ file, spec })));
  const norm = (f: string) => f.split(path.sep).join('/');

  it('imports other modules only through their public contract', () => {
    expect(all.filter(({ spec }) => /\/\d{2}-[a-z-]+\//.test(spec) && !/\/\d{2}-[a-z-]+\/public$/.test(spec))).toEqual([]);
  });
  it('depends only on foundation modules and never on a business module (it listens to events, it does not call them)', () => {
    const deps = new Set(all.flatMap(({ spec }) => { const m = /\/(\d{2})-[a-z-]+\/public$/.exec(spec); return m ? [Number(m[1])] : []; }));
    expect([...deps].every((n) => [0, 3, 4, 6, 12].includes(n))).toBe(true);
  });
  it('reads and writes only its own table', () => {
    const sql = files.filter((f) => f.includes('persistence')).map((f) => readFileSync(f, 'utf8')).join('\n');
    const tables = [...sql.matchAll(/\b(?:FROM|JOIN|INTO)\s+([a-z_]+)/g)].map((m) => m[1]!);
    expect([...new Set(tables)].filter((t) => t !== 'audit_logs')).toEqual([]);
  });
  it('keeps frameworks out of the domain and application layers', () => {
    const inner = all.filter(({ file }) => /\/(domain|application)\//.test(norm(file)));
    expect(inner.filter(({ spec }) => ['express', 'sequelize', 'jsonwebtoken', 'web-push', 'bcryptjs'].includes(spec))).toEqual([]);
  });
  it('is append-only: no UPDATE, no DELETE, no soft delete anywhere in the module', () => {
    const sources = files.map((f) => readFileSync(f, 'utf8')).join('\n');
    expect(sources).not.toMatch(/\bUPDATE\s+audit_logs\b/i);
    expect(sources).not.toMatch(/\bDELETE\s+FROM\s+audit_logs\b/i);
    expect(sources).not.toMatch(/deleted_at|deletedAt/i);
  });
  it('exposes no HTTP write endpoint', () => {
    const routes = readFileSync(path.join(root, 'presentation/http/audit-routes.ts'), 'utf8');
    expect(routes).not.toMatch(/router\.(post|put|patch|delete)\(/);
  });
});
