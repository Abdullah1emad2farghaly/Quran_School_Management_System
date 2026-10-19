import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PARENT_ERROR_MESSAGES, ParentErrorCodes } from '../../../src/modules/17-parents/public';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? sourceFiles(full) : full.endsWith('.ts') ? [full] : [];
  });
}
const where = (file: string) => file.split(path.sep).join('/');
const stripComments = (f: string) => readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');

describe('error messages', () => {
  it('has Arabic and English text for every parent error code', () => {
    for (const code of Object.values(ParentErrorCodes)) {
      const entry = PARENT_ERROR_MESSAGES.find((m) => m.code === code);
      expect(entry, code).toBeDefined();
      expect(entry!.message.ar.length).toBeGreaterThan(0);
      expect(entry!.message.en.length).toBeGreaterThan(0);
    }
  });
});

describe('Module 17 boundaries', () => {
  const root = path.resolve(__dirname, '../../../src/modules/17-parents');
  const files = sourceFiles(root);
  const imports = files.flatMap((file) => [...readFileSync(file, 'utf8').matchAll(/from '([^']+)'/g)].map((m) => ({ file, spec: m[1]! })));

  it('imports other modules only through their public contract', () => {
    expect(imports.filter(({ spec }) => /\/\d{2}-[a-z-]+\//.test(spec) && !/\/\d{2}-[a-z-]+\/public$/.test(spec))).toEqual([]);
  });

  it('depends only on lower-numbered modules (no circular dependency)', () => {
    const bad = imports.filter(({ spec }) => {
      const m = /\/(\d{2})-[a-z-]+\/public$/.exec(spec);
      return m !== null && Number(m[1]) >= 17;
    });
    expect(bad).toEqual([]);
  });

  it('never reads another module\'s tables or private persistence (no SQL on users, roles, schools, geography...)', () => {
    const own = /\b(parents|parent_addresses|parent_schools)\b/;
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
    expect(files.filter((f) => /policies\.register\(/.test(stripComments(f))).map((f) => path.basename(f))).toEqual(['parent-authorization.ts']);
    expect(files.filter((f) => /\b(router|Router)\b/.test(stripComments(f)) && !where(f).includes('/presentation/'))).toEqual([]);
  });

  it('uses Module 15 for the address rules (free-text center/village, no registered ids) and has no scattered role checks', () => {
    expect(files.filter((f) => /15-unified-address/.test(readFileSync(f, 'utf8'))).map((f) => path.basename(f)).sort()).toEqual(['parent-service.ts']);
    expect(files.filter((f) => /\bcenterId\b|\bvillageId\b|center_id|village_id/.test(readFileSync(f, 'utf8')))).toEqual([]);
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
    expect(readFileSync(path.resolve(__dirname, '../../../src/config/parents.ts'), 'utf-8')).not.toMatch(/accountNames|verifiedNames/);
  });

  it('TRIPWIRE: the temporary "no students yet" unlink guard is wired only while Module 19 has no source code', () => {
    const students = path.resolve(__dirname, '../../../src/modules/19-students');
    const hasSources = sourceFiles(students).length > 0;
    const config = readFileSync(path.resolve(__dirname, '../../../src/config/parents.ts'), 'utf-8');
    const usesTemporaryGuard = /studentDependencies:\s*STUDENTS_MODULE_NOT_IMPLEMENTED_YET/.test(config);
    // When Module 19 is implemented this fails on purpose: wire the Students module's real guard (it must count the Parent's students in the
    // school consistently inside the unlink transaction) and delete the temporary one.
    expect({ module19HasSources: hasSources, usesTemporaryGuard: hasSources && usesTemporaryGuard }).toEqual({ module19HasSources: hasSources, usesTemporaryGuard: false });
    expect(usesTemporaryGuard || hasSources).toBe(true); // some guard is always wired
  });

  it('has no global parent deactivation or deletion (decision D-3 is open) and never touches passwords itself', () => {
    for (const f of files) {
      const text = stripComments(f);
      expect([path.basename(f), /deactivateParent|deleteParent|DELETE\s+FROM\s+parent|deactivateUser|activateUser/i.test(text)]).toEqual([path.basename(f), false]);
      expect([path.basename(f), /\bchangePassword\b|\bhasher\b|bcrypt|passwordHash/i.test(text)]).toEqual([path.basename(f), false]);
    }
  });
});
