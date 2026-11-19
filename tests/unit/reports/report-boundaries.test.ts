import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? sourceFiles(full) : full.endsWith('.ts') ? [full] : [];
  });
}

describe('Module 37 boundaries (first slice)', () => {
  const root = path.resolve(__dirname, '../../../src/modules/37-reports-core');
  const files = sourceFiles(root);
  const all = files.flatMap((file) => [...readFileSync(file, 'utf8').matchAll(/from '([^']+)'/g)].map((m) => ({ file, spec: m[1]! })));

  it('imports other modules only through their public contract', () => {
    expect(all.filter(({ spec }) => /\/\d{2}-[a-z-]+\//.test(spec) && !/\/\d{2}-[a-z-]+\/public$/.test(spec))).toEqual([]);
  });
  it('depends only on lower-numbered modules (never on Module 38+)', () => {
    const deps = new Set(all.flatMap(({ spec }) => { const m = /\/(\d{2})-[a-z-]+\/public$/.exec(spec); return m ? [Number(m[1])] : []; }));
    expect([...deps].filter((n) => n >= 37)).toEqual([]);
  });
  it('keeps frameworks out (pure domain and application: no express, sequelize, database access)', () => {
    expect(all.filter(({ spec }) => ['express', 'sequelize', 'express-validator', 'jsonwebtoken'].includes(spec))).toEqual([]);
  });
  it('owns no table, exposes no HTTP route, registers no permission and contains no report-specific code (the reports are Module 38\'s)', () => {
    const rel = files.map((f) => f.split(path.sep).join('/'));
    expect(rel.filter((f) => /\/(presentation|persistence)\//.test(f))).toEqual([]); // no endpoint, no repository, no table
    expect(rel.filter((f) => /\/infrastructure\//.test(f)).map((f) => path.basename(f))).toEqual(['public-report-scope-sources.ts']); // only the read-only scope adapter
    expect(all.filter(({ spec }) => /\/12-authorization-engine\//.test(spec))).toEqual([]);
    expect(all.filter(({ spec }) => /\/38-report-modules\//.test(spec))).toEqual([]);
    const code = files.map((f) => readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')).join('\n');
    expect(/router\.(get|post|put|patch|delete)\(|\bSELECT\b|\bINSERT\b|QueryTypes|createTable/i.test(code)).toBe(false);
  });

  it('the scope adapter reads other modules only through their public contracts and has no geographic assignment source of its own', () => {
    const adapter = readFileSync(path.join(root, 'infrastructure/services/public-report-scope-sources.ts'), 'utf8');
    expect(adapter).toMatch(/async geographicAreasOfManager\([^)]*\)[^{]*\{\s*return undefined;/);
    const specs = [...adapter.matchAll(/from '([^']+)'/g)].map((m) => m[1]!);
    expect(specs.filter((spec) => /\/\d{2}-[a-z-]+\//.test(spec) && !/\/\d{2}-[a-z-]+\/public$/.test(spec))).toEqual([]);
  });

  it('only the composition root (src/config), Module 37 itself and the Module 38 report service use the scope resolver; no module imports another module\'s non-public path', () => {
    const src = path.resolve(__dirname, '../../../src');
    const users = sourceFiles(src).filter((f) => !f.split(path.sep).join('/').includes('/37-reports-core/') && /ReportScopeResolver|PublicReportScopeSources/.test(readFileSync(f, 'utf8')));
    expect(users.map((f) => path.relative(src, f).split(path.sep).join('/')).sort()).toEqual(['config/report-modules.ts', 'config/reports.ts', 'modules/38-report-modules/application/services/report-service.ts']);
  });
});
