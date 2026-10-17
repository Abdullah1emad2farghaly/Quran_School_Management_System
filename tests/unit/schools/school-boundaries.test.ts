import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SCHOOL_ERROR_MESSAGES, SchoolErrorCodes } from '../../../src/modules/16-schools/public';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? sourceFiles(full) : full.endsWith('.ts') ? [full] : [];
  });
}

describe('error messages', () => {
  it('has Arabic and English text for every school error code', () => {
    for (const code of Object.values(SchoolErrorCodes)) {
      const entry = SCHOOL_ERROR_MESSAGES.find((m) => m.code === code);
      expect(entry, code).toBeDefined();
      expect(entry!.message.ar.length).toBeGreaterThan(0);
      expect(entry!.message.en.length).toBeGreaterThan(0);
    }
  });
});

describe('Module 16 boundaries', () => {
  const root = path.resolve(__dirname, '../../../src/modules/16-schools');
  const files = sourceFiles(root);
  const imports = files.flatMap((file) => [...readFileSync(file, 'utf8').matchAll(/from '([^']+)'/g)].map((m) => ({ file, spec: m[1]! })));

  it('imports other modules only through their public contract', () => {
    expect(imports.filter(({ spec }) => /\/\d{2}-[a-z-]+\//.test(spec) && !/\/\d{2}-[a-z-]+\/public$/.test(spec))).toEqual([]);
  });

  it('depends only on lower-numbered modules (no circular dependency)', () => {
    const bad = imports.filter(({ spec }) => {
      const m = /\/(\d{2})-[a-z-]+\/public$/.exec(spec);
      return m !== null && Number(m[1]) >= 16;
    });
    expect(bad).toEqual([]);
  });

  it('keeps persistence code inside infrastructure and HTTP framework code inside presentation', () => {
    const where = (file: string) => file.split(path.sep).join('/');
    const sequelize = imports.filter(({ file, spec }) => spec === 'sequelize' && !where(file).includes('/infrastructure/'));
    const http = imports.filter(({ file, spec }) => ['express', 'express-validator'].includes(spec) && !where(file).includes('/presentation/'));
    expect([...sequelize, ...http]).toEqual([]);
  });

  it('exposes HTTP routes only from the presentation layer; only routes call requirePermission; permissions are registered only through the shared engine registry', () => {
    const where = (file: string) => file.split(path.sep).join('/');
    const code = (f: string) => readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');
    expect(files.filter((f) => /\brequirePermission\b/.test(code(f)) && !where(f).includes('/presentation/'))).toEqual([]);
    expect(files.filter((f) => /\bPermissionRegistry\b|getAuthorizationPolicyRegistry/.test(code(f)))).toEqual([]); // no second registry: only the injected engine registry
    expect(files.filter((f) => /\.register\(\{/.test(code(f))).map((f) => path.basename(f))).toEqual(['school-authorization.ts']);
    expect(files.filter((f) => /\b(router|Router)\b/.test(readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '')) && !/\/presentation\//.test(f.split(path.sep).join('/')))).toEqual([]);
  });

  it('uses Module 15 for ALL addresses (school and organization): free-text center and village, no registered ids', () => {
    const users = files.filter((f) => /15-unified-address/.test(readFileSync(f, 'utf8')));
    expect(users.map((f) => path.basename(f)).sort()).toEqual(['organization-registration-service.ts', 'school-service.ts']);
    expect(files.filter((f) => /\bcenterId\b|\bvillageId\b|center_id|village_id/.test(readFileSync(f, 'utf8')))).toEqual([]);
  });

  it('has no scattered role checks and no Main/Sub classification left in the module', () => {
    for (const f of files) {
      const text = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');
      expect([path.basename(f), /SCHOOL_ACTION_NOT_ALLOWED|requireSchoolAdmin|hasRole\([^)]*'MAIN_ADMIN'/.test(text)]).toEqual([path.basename(f), false]);
      expect([path.basename(f), /MAIN_SCHOOL|SUB_SCHOOL|schoolType|parentSchoolId|parent_school_id|createMainSchool|requestSubSchool|SubSchool/.test(text)]).toEqual([path.basename(f), false]);
    }
  });
});
