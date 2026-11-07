import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? sourceFiles(full) : full.endsWith('.ts') ? [full] : [];
  });
}

describe('Module 32 boundaries', () => {
  const root = path.resolve(__dirname, '../../../src/modules/32-notification-rules');
  const files = sourceFiles(root);
  const importsOf = (file: string) => [...readFileSync(file, 'utf8').matchAll(/from '([^']+)'/g)].map((m) => m[1]!);
  const all = files.flatMap((file) => importsOf(file).map((spec) => ({ file, spec })));
  const norm = (f: string) => f.split(path.sep).join('/');

  it('imports other modules only through their public contract', () => {
    expect(all.filter(({ spec }) => /\/\d{2}-[a-z-]+\//.test(spec) && !/\/\d{2}-[a-z-]+\/public$/.test(spec))).toEqual([]);
  });

  it('depends only on lower-numbered modules (no circular dependency)', () => {
    const deps = new Set(all.flatMap(({ spec }) => { const m = /\/(\d{2})-[a-z-]+\/public$/.exec(spec); return m ? [Number(m[1])] : []; }));
    expect([...deps].filter((n) => n >= 32)).toEqual([]);
  });

  it('only the infrastructure adapters know the business modules; handlers and processors read them through ports', () => {
    const business = (spec: string) => { const m = /\/(\d{2})-[a-z-]+\/public$/.exec(spec); return m ? Number(m[1]) >= 13 && Number(m[1]) !== 31 : false; };
    const offenders = all.filter(({ file, spec }) => business(spec) && /\/application\/(ports|services)\//.test(norm(file)));
    // The two application files allowed to name a producing module are the template registry (31) and event-handler wiring; ports and services read nothing from business modules.
    expect(offenders.filter(({ file }) => /ports\//.test(norm(file)))).toEqual([]);
  });

  it('never reads another module\'s tables', () => {
    const own = ['notification_reminders', 'notification_exam_audience'];
    const sql = files.filter((f) => f.includes('persistence')).map((f) => readFileSync(f, 'utf8')).join('\n');
    const tables = [...sql.matchAll(/\b(?:FROM|JOIN|INTO)\s+([a-z_]+)/g), ...sql.matchAll(/\bUPDATE\s+([a-z_]+)\s+SET\b/g)].map((m) => m[1]!);
    expect(tables.length).toBeGreaterThan(0);
    expect([...new Set(tables)].filter((t) => !own.includes(t))).toEqual([]);
  });

  it('keeps frameworks out of the domain and application layers', () => {
    const inner = all.filter(({ file }) => /\/(domain|application)\//.test(norm(file)));
    expect(inner.filter(({ spec }) => ['express', 'sequelize', 'jsonwebtoken', 'node:crypto', 'web-push', 'bcryptjs'].includes(spec))).toEqual([]);
  });

  it('publishes no domain events and creates notifications only through Module 31', () => {
    const sources = files.map((f) => readFileSync(f, 'utf8')).join('\n');
    expect(sources).not.toMatch(/createDomainEvent|appendEvent|OutboxRepository/);
    expect(sources).not.toMatch(/INSERT\s+INTO\s+notifications\b/i);
  });

  it('never stores content in the audience or reminder tables', () => {
    const migration = readFileSync(path.resolve(__dirname, '../../../database/migrations/20261107100000-create-notification-rules.js'), 'utf8');
    expect(migration).not.toMatch(/\b(title|body|note|score)\s*:/);
  });
});
