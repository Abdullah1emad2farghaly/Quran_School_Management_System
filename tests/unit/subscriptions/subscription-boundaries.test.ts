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

  it('exposes NO payment-status operation over HTTP: only waiving changes a status (PAID <-> UNPAID belongs to Module 34)', () => {
    const routes = readFileSync(path.join(root, 'presentation/http/subscription-routes.ts'), 'utf8');
    const verbs = [...routes.matchAll(/router\.(get|post|put|patch|delete)\(\s*'([^']+)'/g)].map((m) => `${m[1]} ${m[2]}`);
    expect(verbs.length).toBeGreaterThan(8);
    expect(verbs).toContain('post /:id/waive');
    expect(verbs).not.toContain('post /:id/mark-paid');
    expect(verbs).not.toContain('post /:id/mark-unpaid');
    // nothing mentions paying, collecting or amounts, and a subscription is never edited, replaced or deleted over HTTP
    expect(verbs.filter((v) => /paid|\bpay|payment|collect(?!ors)|charge|amount|reversal|refund/i.test(v))).toEqual([]);
    expect(verbs.filter((v) => /^(put|patch|delete) \/:id/.test(v))).toEqual([]);
    // the handlers and the service expose no way to pay, un-pay or reverse
    const handlers = readFileSync(path.join(root, 'presentation/http/subscription-handlers.ts'), 'utf8');
    expect(handlers).not.toMatch(/markPaid|markUnpaid|reversePaid|applyPayment/);
    const service = readFileSync(path.join(root, 'application/services/subscription-service.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(service).not.toMatch(/markPaid|markUnpaid|reversePaid|revertPayment|applyPayment/);
  });

  it('PAID <-> UNPAID transitions live ONLY in the controlled contract, and only Module 34 (and the composition root) use it', () => {
    const src = path.resolve(__dirname, '../../../src');
    const users = sourceFiles(src).filter((f) => !f.split(path.sep).join('/').includes('/33-subscriptions/') && /SubscriptionPaymentTransitions|SubscriptionPayments|applyPayment(Recorded|Reversed)/.test(readFileSync(f, 'utf8')));
    const rel = users.map((f) => path.relative(src, f).split(path.sep).join('/')).sort();
    expect(rel.filter((f) => !f.startsWith('modules/34-payments-collection/') && !['config/subscriptions.ts', 'config/payments.ts'].includes(f))).toEqual([]);
    const contract = readFileSync(path.join(root, 'application/services/subscription-payment-transitions.ts'), 'utf8');
    expect(contract).toMatch(/applyPaymentRecorded\(input: PaymentTransitionInput, tx: TransactionContext\)/); // a transaction is mandatory
    expect(contract).toMatch(/applyPaymentReversed\(input: PaymentTransitionInput, tx: TransactionContext\)/);
  });

  it('only Module 34\'s PaymentService receives the contract: it is built in ONE place and handed to ONE place; nothing else constructs, imports or calls it', () => {
    const src = path.resolve(__dirname, '../../../src');
    const rel = (f: string) => path.relative(src, f).split(path.sep).join('/');
    const outside = sourceFiles(src).filter((f) => !rel(f).startsWith('modules/33-subscriptions/'));
    const text = (f: string) => readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(outside.filter((f) => /new SubscriptionPaymentTransitions\(/.test(text(f))).map(rel)).toEqual(['config/subscriptions.ts']);
    expect(outside.filter((f) => /getSubscriptionPaymentTransitions/.test(text(f))).map(rel).sort()).toEqual(['config/payments.ts', 'config/subscriptions.ts']);
    expect(outside.filter((f) => /\.applyPayment(Recorded|Reversed)\(/.test(text(f))).map(rel)).toEqual(['modules/34-payments-collection/application/services/payment-service.ts']);
    expect(outside.filter((f) => /(?:type SubscriptionPayments\b|:\s*SubscriptionPayments\b)/.test(text(f))).map(rel).sort()).toEqual(['modules/34-payments-collection/application/services/payment-service.ts']);
    // the contract has exactly two public methods and no general-purpose status update
    const contract = text(path.join(root, 'application/services/subscription-payment-transitions.ts'));
    const methods = [...contract.matchAll(/^  (?:async )?([a-zA-Z]+)\(/gm)].map((m) => m[1]!).filter((n) => n !== 'constructor');
    expect(methods.sort()).toEqual(['applyPaymentRecorded', 'applyPaymentReversed']);
    expect(/\b(setStatus|updateStatus|changeStatus|markPaid|markUnpaid|reversePaid)\b/.test(contract.replace(/target\.markPaid/g, ''))).toBe(false);
  });

  it('the group reads are read-only: they call no repository write and publish nothing', () => {
    const service = readFileSync(path.join(root, 'application/services/subscription-group-service.ts'), 'utf8');
    expect(service).not.toMatch(/\.(insert|insertMany|insertBatch|update|lockById|lockAllOfStudent)\(|publishFrom|outbox/);
    const roster = readFileSync(path.join(root, 'infrastructure/services/public-school-group-roster.ts'), 'utf8');
    expect(roster).not.toMatch(/sequelize|QueryTypes|\bSELECT\b|\bINSERT\b/i); // groups are read through Module 20's public service only
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
