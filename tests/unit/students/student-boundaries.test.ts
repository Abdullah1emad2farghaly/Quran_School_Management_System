import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { STUDENT_ERROR_MESSAGES, StudentErrorCodes } from '../../../src/modules/19-students/public';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? sourceFiles(full) : full.endsWith('.ts') ? [full] : [];
  });
}
const where = (file: string) => file.split(path.sep).join('/');
const stripComments = (f: string) => readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');
const ROOT = path.resolve(__dirname, '../../..');

describe('error messages', () => {
  it('has Arabic and English text for every student error code', () => {
    for (const code of Object.values(StudentErrorCodes)) {
      const entry = STUDENT_ERROR_MESSAGES.find((m) => m.code === code);
      expect(entry, code).toBeDefined();
      expect(entry!.message.ar.length).toBeGreaterThan(0);
      expect(entry!.message.en.length).toBeGreaterThan(0);
    }
  });
});

describe('Module 19 boundaries', () => {
  const root = path.join(ROOT, 'src/modules/19-students');
  const files = sourceFiles(root);
  const imports = files.flatMap((file) => [...readFileSync(file, 'utf8').matchAll(/from '([^']+)'/g)].map((m) => ({ file, spec: m[1]! })));

  it('imports other modules only through their public contract', () => {
    expect(imports.filter(({ spec }) => /\/\d{2}-[a-z-]+\//.test(spec) && !/\/\d{2}-[a-z-]+\/public$/.test(spec))).toEqual([]);
  });

  it('depends only on lower-numbered modules (no circular dependency)', () => {
    const bad = imports.filter(({ spec }) => {
      const m = /\/(\d{2})-[a-z-]+\/public$/.exec(spec);
      return m !== null && Number(m[1]) >= 19;
    });
    expect(bad).toEqual([]);
  });

  it('never reads another module\'s tables or private persistence (own tables: students, student_history)', () => {
    const own = /^(students|student_history)$/;
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
    expect(files.filter((f) => /policies\.register\(/.test(stripComments(f))).map((f) => path.basename(f))).toEqual(['student-authorization.ts']);
    expect(files.filter((f) => /\b(router|Router)\b/.test(stripComments(f)) && !where(f).includes('/presentation/'))).toEqual([]);
  });

  it('has no scattered role checks and no cross-module scope bypass', () => {
    for (const f of files) {
      expect([path.basename(f), /hasRole\([^)]*'(MAIN_ADMIN|ORGANIZATION_MANAGER|SCHOOL_MANAGER)'/.test(stripComments(f))]).toEqual([path.basename(f), false]);
    }
  });

  it('is a business entity only: no login, password, token, session or user creation', () => {
    for (const f of files) {
      const text = stripComments(f);
      expect([path.basename(f), /\bchangePassword\b|\bhasher\b|bcrypt|passwordHash|createUser|assignRole|accessToken|refreshToken|sessionId/i.test(text)]).toEqual([path.basename(f), false]);
    }
  });

  it('never deletes a student and never updates the Parent, school or National ID', () => {
    for (const f of files) {
      const text = stripComments(f);
      expect([path.basename(f), /DELETE\s+FROM\s+student|deleteStudent|removeStudent|destroy\(/i.test(text)]).toEqual([path.basename(f), false]);
    }
    const repo = stripComments(path.join(root, 'infrastructure/persistence/sequelize/repositories/sequelize-student-repository.ts'));
    const update = /UPDATE students SET ([^']+) WHERE/.exec(repo)![1]!;
    expect(update).not.toMatch(/national_id|parent_id|school_id|organization_id/);
  });

  it('stores no group and no address of its own (Module 20 owns the group, the Parent owns the address)', () => {
    for (const f of files.filter((x) => /\/(domain|infrastructure)\//.test(where(x)))) {
      const text = stripComments(f);
      expect([path.basename(f), /group_?id|groupId|governorate_?id|center_?name|village_?name/i.test(text)]).toEqual([path.basename(f), false]);
    }
    const migration = stripComments(path.join(ROOT, 'database/migrations/20261020100000-create-students.js'));
    expect(migration).not.toMatch(/group_id|governorate|address|password|username/i);
  });

  it('the migration has the GLOBAL National ID unique index (no school/organization column in it), the CHECKs and no foreign key to another module', () => {
    const migration = readFileSync(path.join(ROOT, 'database/migrations/20261020100000-create-students.js'), 'utf8');
    expect(migration).toMatch(/addIndex\('students', \['national_id'\], \{ unique: true/);
    expect(migration).toMatch(/ck_students_status/);
    expect(migration).toMatch(/ck_students_national_id/);
    const references = [...migration.matchAll(/references: \{ model: '([a-z_]+)'/g)].map((m) => m[1]);
    expect(references).toEqual(['students']);
  });

  it('TRIPWIRE: the temporary "no groups yet" Teacher stand-in is wired only while Module 20 has no source code', () => {
    const groups = path.join(ROOT, 'src/modules/20-groups');
    const hasSources = sourceFiles(groups).length > 0;
    const config = readFileSync(path.join(ROOT, 'src/config/students.ts'), 'utf-8');
    const usesStandIn = /groupAccess:\s*GROUPS_MODULE_NOT_IMPLEMENTED_YET_FOR_STUDENTS/.test(config);
    // When Module 20 is implemented this fails on purpose: wire the Groups module's real StudentGroupAccess and delete the stand-in.
    expect({ module20HasSources: hasSources, usesStandIn: hasSources && usesStandIn }).toEqual({ module20HasSources: hasSources, usesStandIn: false });
    expect(usesStandIn || hasSources).toBe(true); // some implementation is always wired
  });

  it('Module 17 now uses the REAL Students unlink guard, not the temporary one', () => {
    const config = readFileSync(path.join(ROOT, 'src/config/parents.ts'), 'utf-8');
    expect(config).not.toMatch(/STUDENTS_MODULE_NOT_IMPLEMENTED_YET/);
    expect(config).toMatch(/getStudentService\(\)\.countStudentsOfParentInSchool/);
  });
});
