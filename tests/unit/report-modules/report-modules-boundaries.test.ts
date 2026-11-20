import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? sourceFiles(full) : full.endsWith('.ts') ? [full] : [];
  });
}

describe('Module 38 boundaries (slice 1: PAYMENT and ATTENDANCE reports)', () => {
  const root = path.resolve(__dirname, '../../../src/modules/38-report-modules');
  const files = sourceFiles(root);
  const rel = (f: string) => f.split(path.sep).join('/');
  const all = files.flatMap((file) => [...readFileSync(file, 'utf8').matchAll(/from '([^']+)'/g)].map((m) => ({ file: rel(file), spec: m[1]! })));
  const code = (f: string) => readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  it('imports other modules only through their public contract, and only lower-numbered ones', () => {
    const modules = all.filter(({ spec }) => /\/\d{2}-[a-z-]+\//.test(spec));
    expect(modules.filter(({ spec }) => !/\/\d{2}-[a-z-]+\/public$/.test(spec))).toEqual([]);
    const deps = new Set(modules.map(({ spec }) => Number(/\/(\d{2})-/.exec(spec)![1])));
    expect([...deps].filter((n) => n >= 38)).toEqual([]);
    expect([...deps].sort((a, b) => a - b)).toEqual([0, 4, 16, 18, 19, 20, 26, 33, 34, 37]);
  });

  it('owns no table and no repository: it reads only through public contracts and never imports a database library', () => {
    expect(files.map(rel).filter((f) => /\/persistence\//.test(f))).toEqual([]);
    expect(all.filter(({ spec }) => ['sequelize', 'mysql2'].includes(spec))).toEqual([]);
    expect(files.some((f) => /\bSELECT\b|\bINSERT\b|QueryTypes|createTable/i.test(code(f)))).toBe(false);
  });

  it('registers no permission of its own: authorization is Module 37\'s reporting scope', () => {
    expect(all.filter(({ spec }) => /\/12-authorization-engine\//.test(spec))).toEqual([]);
    expect(files.some((f) => /requirePermission|PolicyRegistry|registerPermission/.test(code(f)))).toBe(false);
  });

  it('keeps frameworks out of the domain and application layers (express and exceljs live in presentation and infrastructure)', () => {
    const inner = all.filter(({ file }) => /\/(domain|application)\//.test(file));
    expect(inner.filter(({ spec }) => ['express', 'express-validator', 'exceljs'].includes(spec))).toEqual([]);
  });

  it('exposes only GET routes and every one is behind authentication', () => {
    const routes = code(path.join(root, 'presentation/http/report-routes.ts'));
    expect(/router\.(post|put|patch|delete)\(/.test(routes)).toBe(false);
    const gets = [...routes.matchAll(/router\.get\(\s*([^,]+),\s*(\w+)/g)];
    expect(gets.length).toBeGreaterThan(0);
    expect(gets.map((m) => m[2])).toEqual(gets.map(() => 'auth'));
  });

  it('takes the requester from the verified session only (never from the request)', () => {
    const session = code(path.join(root, 'presentation/http/session-required.ts'));
    expect(session).toContain('req.auth.userId');
    expect(session).toContain('req.auth.activeRole');
    const routes = code(path.join(root, 'presentation/http/report-routes.ts'));
    expect(/req\.(query|body|params)\.(userId|role|activeRole)/.test(routes)).toBe(false);
  });
});
