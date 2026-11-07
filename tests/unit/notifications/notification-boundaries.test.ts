import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { NOTIFICATION_ERROR_MESSAGES, NotificationErrorCodes } from '../../../src/modules/31-notifications-core/public';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? sourceFiles(full) : full.endsWith('.ts') ? [full] : [];
  });
}

describe('notification error messages', () => {
  it('has Arabic and English text for every code', () => {
    for (const code of Object.values(NotificationErrorCodes)) {
      const entry = NOTIFICATION_ERROR_MESSAGES.find((m) => m.code === code);
      expect(entry, code).toBeDefined();
      expect(entry!.message.ar.length).toBeGreaterThan(0);
      expect(entry!.message.en.length).toBeGreaterThan(0);
    }
  });
});

describe('Module 31 boundaries', () => {
  const root = path.resolve(__dirname, '../../../src/modules/31-notifications-core');
  const files = sourceFiles(root);
  const importsOf = (file: string) => [...readFileSync(file, 'utf8').matchAll(/from '([^']+)'/g)].map((m) => m[1]!);
  const all = files.flatMap((file) => importsOf(file).map((spec) => ({ file, spec })));
  const norm = (f: string) => f.split(path.sep).join('/');

  it('imports other modules only through their public contract', () => {
    expect(all.filter(({ spec }) => /\/\d{2}-[a-z-]+\//.test(spec) && !/\/\d{2}-[a-z-]+\/public$/.test(spec))).toEqual([]);
  });

  it('depends only on lower-numbered modules (no circular dependency) and never on a business module', () => {
    const deps = new Set(all.flatMap(({ spec }) => { const m = /\/(\d{2})-[a-z-]+\/public$/.exec(spec); return m ? [Number(m[1])] : []; }));
    expect([...deps].filter((n) => n >= 31)).toEqual([]);
    // Notifications Core knows no business events: only the shared kernel, configuration, localization, validation, outbox and session (revocation) contracts.
    expect([...deps].sort((a, b) => a - b).every((n) => [0, 1, 2, 3, 4, 6, 10].includes(n))).toBe(true);
  });

  it('never reads another module\'s tables', () => {
    const own = ['notifications', 'notification_dedup_keys', 'push_subscriptions', 'push_deliveries'];
    const sql = files.filter((f) => f.includes('persistence')).map((f) => readFileSync(f, 'utf8')).join('\n');
    const tables = [...sql.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE)\s+([a-z_]+)/g)].map((m) => m[1]!).filter((t) => !['SELECT', 'select'].includes(t));
    expect([...new Set(tables)].filter((t) => !own.includes(t))).toEqual([]);
  });

  it('keeps frameworks out of the domain and application layers', () => {
    const inner = all.filter(({ file }) => /\/(domain|application)\//.test(norm(file)));
    expect(inner.filter(({ spec }) => ['express', 'sequelize', 'jsonwebtoken', 'node:crypto', 'web-push', 'bcryptjs'].includes(spec))).toEqual([]);
  });

  it('has no soft delete and never deletes a once-only key', () => {
    const sources = files.map((f) => readFileSync(f, 'utf8')).join('\n');
    expect(sources).not.toMatch(/deleted_at|deletedAt|archived/i);
    expect(sources).not.toMatch(/DELETE\s+FROM\s+notification_dedup_keys/i);
    expect(sources).not.toMatch(/UPDATE\s+notification_dedup_keys/i);
  });

  it('never logs or returns the VAPID private key or an endpoint', () => {
    const offenders = files.filter((f) => /logger\./.test(readFileSync(f, 'utf8')) && /privateKey|endpoint/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('has no environment access of its own (configuration comes from the composition root)', () => {
    expect(files.filter((f) => /process\.env/.test(readFileSync(f, 'utf8')))).toEqual([]);
  });
});
