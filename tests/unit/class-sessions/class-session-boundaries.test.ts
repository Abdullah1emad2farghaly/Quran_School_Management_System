import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { registerAllErrorMessages } from '../../../src/app/bootstrap/register-error-messages';
import { defaultMessageCatalog } from '../../../src/modules/03-error-localization/public';
import { CLASS_SESSION_ERROR_MESSAGES, ClassSessionErrorCodes } from '../../../src/modules/24-sessions/public';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? sourceFiles(full) : full.endsWith('.ts') ? [full] : [];
  });
}
const strip = (text: string) => text.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');
const ROOT = path.resolve(__dirname, '../../..');
const MODULE = path.join(ROOT, 'src/modules/24-sessions');
const files = sourceFiles(MODULE);

describe('Module 24 error messages', () => {
  it('has Arabic and English text for every class session error code, and nothing else', () => {
    expect(CLASS_SESSION_ERROR_MESSAGES.map((m) => m.code).sort()).toEqual(Object.values(ClassSessionErrorCodes).sort());
    for (const m of CLASS_SESSION_ERROR_MESSAGES) {
      expect(m.message.ar.length).toBeGreaterThan(0);
      expect(m.message.en.length).toBeGreaterThan(0);
    }
  });
  it('are registered with the application', () => {
    registerAllErrorMessages();
    for (const c of Object.values(ClassSessionErrorCodes)) expect(defaultMessageCatalog.has(c), c).toBe(true);
  });
});

describe('Module 24 boundaries', () => {
  const imports = files.flatMap((file) => [...readFileSync(file, 'utf8').matchAll(/from '([^']+)'/g)].map((m) => ({ file, spec: m[1]! })));

  it('imports other modules only through their public contract, and only lower-numbered modules', () => {
    expect(imports.filter(({ spec }) => /\/\d{2}-[a-z-]+\//.test(spec) && !/\/\d{2}-[a-z-]+\/public$/.test(spec))).toEqual([]);
    expect(imports.filter(({ spec }) => { const m = /\/(\d{2})-[a-z-]+\/public$/.exec(spec); return m !== null && Number(m[1]) >= 24; })).toEqual([]);
  });

  it('never deletes a session: no DELETE statement and no destroy call anywhere in the module', () => {
    for (const f of files) expect(strip(readFileSync(f, 'utf8')), f).not.toMatch(/\bDELETE\s+FROM\b|\.destroy\(|\bTRUNCATE\b|\bDROP\s+TABLE\b/i);
  });

  it('reads and writes only its own table (class_sessions)', () => {
    const tables = new Set<string>();
    for (const f of files) for (const m of strip(readFileSync(f, 'utf8')).matchAll(/\b(?:FROM|INTO|UPDATE|JOIN)\s+([a-z_]+)/g)) tables.add(m[1]!);
    expect([...tables].filter((t) => t !== 'class_sessions')).toEqual([]);
  });

  it('is deterministic apart from the injected clock (the job\'s own polling timer aside): no Date.now / new Date() / Math.random', () => {
    for (const f of files.filter((x) => !x.endsWith('class-session-scheduler.ts'))) expect(strip(readFileSync(f, 'utf8')), f).not.toMatch(/\b(Date\.now|new Date\(\s*\)|Math\.random)/);
  });

  it('does not depend on Module 22 or on any teaching-record module: nothing in the approved Module 24 behaviour uses them', () => {
    expect(imports.filter(({ spec }) => /\/22-|\/2[5-9]-|\/3\d-/.test(spec))).toEqual([]);
  });

  it('has no endpoint that creates, starts, completes, edits or deletes a session', () => {
    const routes = strip(readFileSync(path.join(MODULE, 'presentation/http/session-routes.ts'), 'utf8'));
    expect([...routes.matchAll(/router\.(get|post|put|patch|delete)\(\s*'([^']*)'/g)].map((m) => `${m[1]} ${m[2]}`)).toEqual(['get /mine', 'get /groups/:id', 'get /:id', 'post /:id/cancel']);
  });
});
