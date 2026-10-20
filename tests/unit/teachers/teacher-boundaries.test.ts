import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { TEACHER_ERROR_MESSAGES, TeacherErrorCodes } from '../../../src/modules/18-teachers/public';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? sourceFiles(full) : full.endsWith('.ts') ? [full] : [];
  });
}
const where = (file: string) => file.split(path.sep).join('/');
const stripComments = (f: string) => readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');

describe('error messages', () => {
  it('has Arabic and English text for every teacher error code', () => {
    for (const code of Object.values(TeacherErrorCodes)) {
      const entry = TEACHER_ERROR_MESSAGES.find((m) => m.code === code);
      expect(entry, code).toBeDefined();
      expect(entry!.message.ar.length).toBeGreaterThan(0);
      expect(entry!.message.en.length).toBeGreaterThan(0);
    }
  });
});

describe('Module 18 boundaries', () => {
  const root = path.resolve(__dirname, '../../../src/modules/18-teachers');
  const files = sourceFiles(root);
  const imports = files.flatMap((file) => [...readFileSync(file, 'utf8').matchAll(/from '([^']+)'/g)].map((m) => ({ file, spec: m[1]! })));

  it('imports other modules only through their public contract', () => {
    expect(imports.filter(({ spec }) => /\/\d{2}-[a-z-]+\//.test(spec) && !/\/\d{2}-[a-z-]+\/public$/.test(spec))).toEqual([]);
  });

  it('depends only on lower-numbered modules (no circular dependency)', () => {
    const bad = imports.filter(({ spec }) => {
      const m = /\/(\d{2})-[a-z-]+\/public$/.exec(spec);
      return m !== null && Number(m[1]) >= 18;
    });
    expect(bad).toEqual([]);
  });

  it('never reads another module\'s tables or private persistence (no SQL on users, roles, schools, geography...)', () => {
    const own = /\b(teachers|teacher_schools)\b/;
    for (const f of files.filter((x) => where(x).includes('/infrastructure/persistence/'))) {
      const tables = [...stripComments(f).matchAll(/\b(?:FROM|JOIN|INTO|UPDATE)\s+([a-z_]+)/gi)].map((m) => m[1]!.toLowerCase());
      expect([path.basename(f), tables.filter((t) => !own.test(t))]).toEqual([path.basename(f), []]);
    }
  });

  it('keeps persistence code inside infrastructure and HTTP framework code inside presentation', () => {
    const sequelize = imports.filter(({ file, spec }) => spec === 'sequelize' && !where(file).includes('/infrastructure/'));
    const http = imports.filter(({ file, spec }) => ['express', 'express-validator'].includes(spec) && !where(file).includes('/presentation/'));
    expect([...sequelize, ...http]).toEqual([]);
  });

  it('exposes routes only from presentation; only routes call requirePermission; permissions go only through the shared engine registry', () => {
    expect(files.filter((f) => /\brequirePermission\b/.test(stripComments(f)) && !where(f).includes('/presentation/'))).toEqual([]);
    expect(files.filter((f) => /\bPermissionRegistry\b|getAuthorizationPolicyRegistry/.test(stripComments(f)))).toEqual([]);
    expect(files.filter((f) => /policies\.register\(/.test(stripComments(f))).map((f) => path.basename(f))).toEqual(['teacher-authorization.ts']);
    expect(files.filter((f) => /\b(router|Router)\b/.test(stripComments(f)) && !where(f).includes('/presentation/'))).toEqual([]);
  });

  it('has no scattered role checks', () => {
    for (const f of files) {
      expect([path.basename(f), /hasRole\([^)]*'(MAIN_ADMIN|ORGANIZATION_MANAGER|SCHOOL_MANAGER)'/.test(stripComments(f))]).toEqual([path.basename(f), false]);
    }
  });

  it('stores no personal name of its own: the name is the account\'s canonical name (Module 08)', () => {
    for (const f of files.filter((x) => /\/(domain|infrastructure)\//.test(where(x)))) {
      expect([path.basename(f), /full_?name/i.test(stripComments(f))]).toEqual([path.basename(f), false]);
    }
  });

  it('has no stand-in identity source: existing accounts are matched by the stored account name only', () => {
    expect(files.filter((f) => /VerifiedAccountNames|NO_VERIFIED_ACCOUNT_NAMES|verifiedNamesOf|accountNames/.test(readFileSync(f, 'utf-8')))).toEqual([]);
    expect(readFileSync(path.resolve(__dirname, '../../../src/config/teachers.ts'), 'utf-8')).not.toMatch(/accountNames|verifiedNames/);
  });

  it('TRIPWIRE: the temporary "no groups yet" unlink guard is wired only while Module 20 has no source code', () => {
    const students = path.resolve(__dirname, '../../../src/modules/20-groups');
    const hasSources = sourceFiles(students).length > 0;
    const config = readFileSync(path.resolve(__dirname, '../../../src/config/teachers.ts'), 'utf-8');
    const usesTemporaryGuard = /groupDependencies:\s*GROUPS_MODULE_NOT_IMPLEMENTED_YET/.test(config);
    // When Module 20 is implemented this fails on purpose: wire the Students module's real guard (it must count the Teacher's students in the
    // school consistently inside the unlink transaction) and delete the temporary one.
    expect({ module19HasSources: hasSources, usesTemporaryGuard: hasSources && usesTemporaryGuard }).toEqual({ module19HasSources: hasSources, usesTemporaryGuard: false });
    expect(usesTemporaryGuard || hasSources).toBe(true); // some guard is always wired
  });

  it('has no global teacher deactivation or deletion (decision D-3 is open) and never touches passwords itself', () => {
    for (const f of files) {
      const text = stripComments(f);
      expect([path.basename(f), /deactivateTeacher|deleteTeacher|DELETE\s+FROM\s+teacher|deactivateUser|activateUser/i.test(text)]).toEqual([path.basename(f), false]);
      expect([path.basename(f), /\bchangePassword\b|\bhasher\b|bcrypt|passwordHash/i.test(text)]).toEqual([path.basename(f), false]);
    }
  });
});
