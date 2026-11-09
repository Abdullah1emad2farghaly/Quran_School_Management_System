import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? sourceFiles(full) : full.endsWith('.ts') ? [full] : [];
  });
}

describe('Module 33 boundaries', () => {
  const root = path.resolve(__dirname, '../../../src/modules/33-subscriptions');
  const files = sourceFiles(root);
  const importsOf = (file: string) => [...readFileSync(file, 'utf8').matchAll(/from '([^']+)'/g)].map((m) => m[1]!);
  const all = files.flatMap((file) => importsOf(file).map((spec) => ({ file, spec })));
  const norm = (f: string) => f.split(path.sep).join('/');

  it('imports other modules only through their public contract', () => {
    expect(all.filter(({ spec }) => /\/\d{2}-[a-z-]+\//.test(spec) && !/\/\d{2}-[a-z-]+\/public$/.test(spec))).toEqual([]);
  });

  it('depends only on lower-numbered modules (no circular dependency, never on Module 32 or 34)', () => {
    const deps = new Set(all.flatMap(({ spec }) => { const m = /\/(\d{2})-[a-z-]+\/public$/.exec(spec); return m ? [Number(m[1])] : []; }));
    expect([...deps].filter((n) => n >= 33)).toEqual([]);
  });

  it('never reads another module\'s tables', () => {
    const own = ['subscriptions', 'subscription_batches', 'collector_school_links'];
    const sql = files.filter((f) => norm(f).includes('persistence')).map((f) => readFileSync(f, 'utf8')).join('\n');
    const tables = [...sql.matchAll(/\b(?:FROM|JOIN|INTO)\s+([a-z_]+)/g), ...sql.matchAll(/\bUPDATE\s+([a-z_]+)\s+SET\b/g)].map((m) => m[1]!);
    expect(tables.length).toBeGreaterThan(0);
    expect([...new Set(tables)].filter((t) => !own.includes(t))).toEqual([]);
  });

  it('keeps frameworks out of the domain and application layers', () => {
    const inner = all.filter(({ file }) => /\/(domain|application)\//.test(norm(file)));
    expect(inner.filter(({ spec }) => ['express', 'sequelize', 'jsonwebtoken', 'web-push', 'bcryptjs'].includes(spec))).toEqual([]);
  });

  it('exposes NO HTTP operation that marks a subscription PAID or collects a payment', () => {
    const routes = readFileSync(path.join(root, 'presentation/http/subscription-routes.ts'), 'utf8');
    const verbs = [...routes.matchAll(/router\.(get|post|put|patch|delete)\(\s*'([^']+)'/g)].map((m) => `${m[1]} ${m[2]}`);
    expect(verbs.length).toBeGreaterThan(5);
    expect(verbs.filter((v) => /paid|\bpay|payment|charge|amount/i.test(v))).toEqual([]);
    expect(verbs).not.toContain('post /:id/pay');
  });

  it('has no fee, proration, amount or enrollment-date logic (a subscription is Student + Month + Status)', () => {
    const domain = files.filter((f) => /\/(domain|application\/dto)\//.test(norm(f))).map((f) => readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')).join('\n');
    expect(domain).not.toMatch(/\b(amount|fee|price|prorat\w*|enrollment|joinDate)\b/i);
  });

  it('the migration stores no amount and keeps the module tables free of foreign keys to other modules', () => {
    const migration = readFileSync(path.resolve(__dirname, '../../../database/migrations/20261108100000-create-subscriptions.js'), 'utf8');
    expect(migration).not.toMatch(/\b(amount|fee|price)\b\s*:/i);
    const refs = [...migration.matchAll(/model:\s*'([a-z_]+)'/g)].map((m) => m[1]);
    expect(refs).toEqual(['subscription_batches']);
  });
});
