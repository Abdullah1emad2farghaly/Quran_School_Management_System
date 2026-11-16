import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PermissionRegistry, ASSIGNABLE_ROLE_CODES, ROLE_CODES } from '../../../src/modules/09-roles-permissions/public';
import { AuthorizationPolicyRegistry } from '../../../src/modules/12-authorization-engine/public';
import { QURAN_ERROR_MESSAGES, QuranErrorCodes, QuranPermissions, createQuranRouter, quranApiDoc, registerQuranAuthorization } from '../../../src/modules/21-quran-structure/public';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? sourceFiles(full) : full.endsWith('.ts') ? [full] : [];
  });
}
const where = (file: string) => file.split(path.sep).join('/');
const strip = (text: string) => text.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');
const stripFile = (f: string) => strip(readFileSync(f, 'utf8'));
const ROOT = path.resolve(__dirname, '../../..');

describe('error messages', () => {
  it('has Arabic and English text for every Quran structure error code', () => {
    for (const code of Object.values(QuranErrorCodes)) {
      const entry = QURAN_ERROR_MESSAGES.find((m) => m.code === code);
      expect(entry, code).toBeDefined();
      expect(entry!.message.ar.length).toBeGreaterThan(0);
      expect(entry!.message.en.length).toBeGreaterThan(0);
    }
  });
});

describe('Module 21 authorization (approved: all authenticated users may read; nothing writes)', () => {
  it('registers one UNSCOPED read permission for EVERY assignable role', () => {
    const permissions = new PermissionRegistry();
    const policies = new AuthorizationPolicyRegistry(permissions);
    registerQuranAuthorization({ policies });
    const policy = policies.get(QuranPermissions.READ)!;
    expect(policy).toBeDefined();
    expect(policy.scope).toBe('UNSCOPED');
    expect([...policy.roles].sort()).toEqual([...ASSIGNABLE_ROLE_CODES].sort());
    expect(ASSIGNABLE_ROLE_CODES.length).toBeGreaterThanOrEqual(9);
    expect(ROLE_CODES.filter((r) => !(ASSIGNABLE_ROLE_CODES as readonly string[]).includes(r))).toEqual(['STUDENT']); // a Student has no account, so no permission
    expect(Object.values(QuranPermissions)).toEqual(['quran.structure.read']);
  });
});

describe('Module 21 boundaries', () => {
  const root = path.join(ROOT, 'src/modules/21-quran-structure');
  const files = sourceFiles(root);
  const imports = files.flatMap((file) => [...readFileSync(file, 'utf8').matchAll(/from '([^']+)'/g)].map((m) => ({ file, spec: m[1]! })));

  it('imports other modules only through their public contract, and only lower-numbered modules', () => {
    expect(imports.filter(({ spec }) => /\/\d{2}-[a-z-]+\//.test(spec) && !/\/\d{2}-[a-z-]+\/public$/.test(spec))).toEqual([]);
    expect(imports.filter(({ spec }) => { const m = /\/(\d{2})-[a-z-]+\/public$/.exec(spec); return m !== null && Number(m[1]) >= 21; })).toEqual([]);
  });

  it('reads and writes ONLY its own tables', () => {
    // quran_hizb is RESERVED (empty) for a future version: V1 code must not touch it
    const own = /^(quran_dataset_imports|quran_surahs|quran_ayahs|quran_pages|quran_lines|quran_quarters|quran_quarter_marks|quran_juz)$/;
    for (const f of files.filter((x) => where(x).includes('/infrastructure/persistence/'))) {
      const code = stripFile(f);
      const literal = [...code.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE)\s+([a-z_]+)/gi)].map((m) => m[1]!.toLowerCase());
      const listed = [...code.matchAll(/'(quran_[a-z_]+)'/g)].map((m) => m[1]!);
      expect([path.basename(f), [...literal, ...listed].filter((t) => !own.test(t) && t !== 'select')]).toEqual([path.basename(f), []]);
    }
  });

  it('keeps persistence code inside infrastructure and HTTP framework code inside presentation', () => {
    expect(imports.filter(({ file, spec }) => spec === 'sequelize' && !where(file).includes('/infrastructure/'))).toEqual([]);
    expect(imports.filter(({ file, spec }) => ['express', 'express-validator'].includes(spec) && !where(file).includes('/presentation/'))).toEqual([]);
    expect(files.filter((f) => /\bRouter\b/.test(stripFile(f)) && !where(f).includes('/presentation/'))).toEqual([]);
  });

  it('only routes call requirePermission; the permission is registered only in quran-authorization', () => {
    expect(files.filter((f) => /\brequirePermission\b/.test(stripFile(f)) && !where(f).includes('/presentation/'))).toEqual([]);
    expect(files.filter((f) => /policies\.register\(/.test(stripFile(f))).map((f) => path.basename(f))).toEqual(['quran-authorization.ts']);
  });

  it('is READ-ONLY through the application: no write route, no write on the read port, destructive SQL only in the import store', () => {
    const routes = stripFile(path.join(root, 'presentation/http/quran-routes.ts'));
    expect(routes.match(/router\.(get|post|put|patch|delete|all|use)\(/g)!.every((m) => m.startsWith('router.get'))).toBe(true);
    expect(quranApiDoc.operations.every((o) => o.method === 'get')).toBe(true);
    const port = stripFile(path.join(root, 'application/ports/quran-structure-repository.ts'));
    const readInterface = /interface QuranStructureRepository \{([\s\S]*?)\n\}/.exec(port)![1]!;
    expect(readInterface).not.toMatch(/\b(create|insert|update|delete|remove|save|replace|set)\w*\(/i);
    for (const f of files) {
      const code = stripFile(f);
      const destructive = /DELETE\s+FROM|\bdestroy\(|\bTRUNCATE\b|\bDROP\b/i.test(code);
      expect([path.basename(f), destructive && !where(f).endsWith('sequelize-quran-structure-repository.ts')]).toEqual([path.basename(f), false]);
    }
    expect(typeof createQuranRouter).toBe('function');
  });

  it('never embeds Quran data: no ayah text or layout is hard-coded (only the edition invariants, UI strings and format constants)', () => {
    const arabic = /[\u0600-\u06FF]/;
    // allowed Arabic: API examples, localized messages, the surah-banner prefix of the converter, the Arabic-Indic digits of the end-of-ayah check
    const allowed = new Set(['quran.openapi.ts', 'quran-error-messages.ts', 'kfgqpc-hafs-v30-converter.ts', 'quran-dataset-validator.ts']);
    for (const f of files) {
      const code = stripFile(f);
      expect([path.basename(f), arabic.test(code)]).toEqual([path.basename(f), allowed.has(path.basename(f))]);
    }
  });

  it('uses ONLY the approved sources: the official KFGQPC package and the approved Tanzil quarter file; no other Quran data source is named or read', () => {
    const cliDir = path.join(ROOT, 'src/app/cli');
    const code = [...files, ...readdirSync(cliDir).filter((n) => /quran|kfgqpc/.test(n)).map((n) => path.join(cliDir, n))];
    // the quarter source is read only by the converter, its quarter-file reader and its CLI
    const mayNameTanzil = new Set(['kfgqpc-hafs-v30-converter.ts', 'tanzil-quarters-reader.ts', 'convert-kfgqpc-hafs-cli.ts', 'index.ts']);
    for (const f of code) {
      const raw = readFileSync(f, 'utf8');
      expect([path.basename(f), 'other source', /\bQUL\b|qul\.tarteel|tarteel|quran\.com|quranwbw|alquran\.cloud/i.test(raw)]).toEqual([path.basename(f), 'other source', false]);
      expect([path.basename(f), 'tanzil', /tanzil/i.test(raw) && !mayNameTanzil.has(path.basename(f))]).toEqual([path.basename(f), 'tanzil', false]);
    }
  });
});

describe('Module 20 integration: startingSurah stays a plain surah number that Module 21 resolves', () => {
  it('uses the same 1..114 range as the Quran structure, without a runtime dependency on Module 21', async () => {
    const { QURAN_SURAH_COUNT } = await import('../../../src/modules/21-quran-structure/public');
    const groupSettings = readFileSync(path.join(ROOT, 'src/modules/20-groups/domain/value-objects/group-settings.ts'), 'utf8');
    expect(/SURAH_COUNT\s*=\s*(\d+)/.exec(groupSettings)![1]).toBe(String(QURAN_SURAH_COUNT));
    for (const f of sourceFiles(path.join(ROOT, 'src/modules/20-groups'))) expect(readFileSync(f, 'utf8')).not.toMatch(/21-quran-structure/);
  });
});
