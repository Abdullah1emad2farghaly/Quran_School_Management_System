import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const code = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? sourceFiles(full) : full.endsWith('.ts') ? [full] : [];
  });
}

describe('Module 34 boundaries', () => {
  const root = path.resolve(__dirname, '../../../src/modules/34-payments-collection');
  const files = sourceFiles(root);
  const importsOf = (file: string) => [...readFileSync(file, 'utf8').matchAll(/from '([^']+)'/g)].map((m) => m[1]!);
  const all = files.flatMap((file) => importsOf(file).map((spec) => ({ file, spec })));
  const norm = (f: string) => f.split(path.sep).join('/');

  it('imports other modules only through their public contract', () => {
    expect(all.filter(({ spec }) => /\/\d{2}-[a-z-]+\//.test(spec) && !/\/\d{2}-[a-z-]+\/public$/.test(spec))).toEqual([]);
  });

  it('depends only on lower-numbered modules (no circular dependency, never on a later module such as 35)', () => {
    const deps = new Set(all.flatMap(({ spec }) => { const m = /\/(\d{2})-[a-z-]+\/public$/.exec(spec); return m ? [Number(m[1])] : []; }));
    expect([...deps].filter((n) => n >= 34)).toEqual([]);
  });

  it('reaches subscriptions ONLY through Module 33\'s controlled public contract (applyPaymentRecorded / applyPaymentReversed), never its tables', () => {
    const sql = files.filter((f) => norm(f).includes('persistence')).map((f) => readFileSync(f, 'utf8')).join('\n');
    const tables = [...sql.matchAll(/\b(?:FROM|JOIN|INTO)\s+([a-z_]+)/g), ...sql.matchAll(/\bUPDATE\s+([a-z_]+)\s+SET\b/g)].map((m) => m[1]!);
    expect(tables.length).toBeGreaterThan(0);
    expect([...new Set(tables)].filter((t) => t !== 'payments')).toEqual([]);
  });

  it('changes a subscription status only through the transitions contract with a payment id (never a general status update)', () => {
    const service = code(readFileSync(path.join(root, 'application/services/payment-service.ts'), 'utf8'));
    expect(service).toMatch(/subscriptions\.applyPaymentRecorded\(\{ subscriptionId, paymentId, actorId \}, t\)/);
    expect(service).toMatch(/subscriptions\.applyPaymentReversed\(/);
    expect(service).not.toMatch(/markPaid|markUnpaid|reversePaid|updateStatus|setStatus/);
  });

  it('keeps frameworks out of the domain and application layers', () => {
    const inner = all.filter(({ file }) => /\/(domain|application)\//.test(norm(file)));
    expect(inner.filter(({ spec }) => ['express', 'sequelize', 'jsonwebtoken', 'web-push', 'bcryptjs'].includes(spec))).toEqual([]);
  });

  it('NEVER deletes a payment: no DELETE statement, no delete method on the repository, no delete/put/patch route', () => {
    const everything = files.map((f) => code(readFileSync(f, 'utf8'))).join('\n');
    expect(/\bDELETE\s+FROM\b/i.test(everything)).toBe(false);
    expect(/\bTRUNCATE\b|\bDROP\s+TABLE\b/i.test(everything)).toBe(false);
    const port = code(readFileSync(path.join(root, 'application/ports/payment-repository.ts'), 'utf8'));
    expect(/\b(delete|remove|destroy)\w*\s*\(/i.test(port)).toBe(false);
    const routes = code(readFileSync(path.join(root, 'presentation/http/payment-routes.ts'), 'utf8'));
    const verbs = [...routes.matchAll(/router\.(get|post|put|patch|delete)\(\s*'([^']+)'/g)].map((m) => `${m[1]} ${m[2]}`);
    expect(verbs.sort()).toEqual(['get /:id', 'get /schools/:schoolId', 'post /:id/reverse', 'post /subscriptions/:subscriptionId']);
  });

  it('stores and accepts no amount and no method other than CASH', () => {
    const everything = files.filter((f) => !f.endsWith('.openapi.ts') && !norm(f).includes('error-messages')).map((f) => readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')).join('\n');
    expect(/\b(amount|price|fee|charge)\b/i.test(everything)).toBe(false);
    expect(/PAYMENT_METHODS = \['CASH'\] as const/.test(readFileSync(path.join(root, 'domain/value-objects/payment-vocabulary.ts'), 'utf8'))).toBe(true);
  });

  it('creates no notification itself (its PaymentRecorded event is what Modules 31/32 turn into the Parent\'s notification)', () => {
    expect(all.filter(({ spec }) => /\/3[12]-[a-z-]+\/public$/.test(spec))).toEqual([]);
  });
});
