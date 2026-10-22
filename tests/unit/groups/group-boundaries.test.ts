import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { GROUP_ERROR_MESSAGES, GroupErrorCodes } from '../../../src/modules/20-groups/public';

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
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf-8');

describe('error messages', () => {
  it('has Arabic and English text for every group error code', () => {
    for (const code of Object.values(GroupErrorCodes)) {
      const entry = GROUP_ERROR_MESSAGES.find((m) => m.code === code);
      expect(entry, code).toBeDefined();
      expect(entry!.message.ar.length).toBeGreaterThan(0);
      expect(entry!.message.en.length).toBeGreaterThan(0);
    }
  });
});

describe('Module 20 boundaries', () => {
  const root = path.join(ROOT, 'src/modules/20-groups');
  const files = sourceFiles(root);
  const imports = files.flatMap((file) => [...readFileSync(file, 'utf8').matchAll(/from '([^']+)'/g)].map((m) => ({ file, spec: m[1]! })));

  it('imports other modules only through their public contract', () => {
    expect(imports.filter(({ spec }) => /\/\d{2}-[a-z-]+\//.test(spec) && !/\/\d{2}-[a-z-]+\/public$/.test(spec))).toEqual([]);
  });

  it('depends only on lower-numbered modules (no circular dependency)', () => {
    const bad = imports.filter(({ spec }) => {
      const m = /\/(\d{2})-[a-z-]+\/public$/.exec(spec);
      return m !== null && Number(m[1]) >= 20;
    });
    expect(bad).toEqual([]);
  });

  it('reads and writes ONLY its own tables (school_groups, group_students, group_history)', () => {
    const own = /^(school_groups|group_students|group_history)$/;
    for (const f of files.filter((x) => where(x).includes('/infrastructure/persistence/'))) {
      const tables = [...stripFile(f).matchAll(/\b(?:FROM|JOIN|INTO|UPDATE)\s+([a-z_]+)/gi)].map((m) => m[1]!.toLowerCase());
      expect([path.basename(f), tables.filter((t) => !own.test(t))]).toEqual([path.basename(f), []]);
    }
  });

  it('keeps persistence code inside infrastructure and HTTP framework code inside presentation', () => {
    expect(imports.filter(({ file, spec }) => spec === 'sequelize' && !where(file).includes('/infrastructure/'))).toEqual([]);
    expect(imports.filter(({ file, spec }) => ['express', 'express-validator'].includes(spec) && !where(file).includes('/presentation/'))).toEqual([]);
  });

  it('only routes call requirePermission; permissions are registered only in group-authorization through the shared engine', () => {
    expect(files.filter((f) => /\brequirePermission\b/.test(stripFile(f)) && !where(f).includes('/presentation/'))).toEqual([]);
    expect(files.filter((f) => /policies\.register\(/.test(stripFile(f))).map((f) => path.basename(f))).toEqual(['group-authorization.ts']);
    expect(files.filter((f) => /\b(router|Router)\b/.test(stripFile(f)) && !where(f).includes('/presentation/'))).toEqual([]);
  });

  it('never deletes a group, an assignment or a history row, and never rewrites the school / organization of a group', () => {
    for (const f of files) expect([path.basename(f), /DELETE\s+FROM|\bdeleteGroup\b|\bremoveGroup\b|destroy\(/i.test(stripFile(f))]).toEqual([path.basename(f), false]);
    const repo = stripFile(path.join(root, 'infrastructure/persistence/sequelize/repositories/sequelize-group-repository.ts'));
    expect(/UPDATE school_groups SET ([\s\S]+?) WHERE/.exec(repo)![1]).not.toMatch(/school_id|organization_id|created_by/);
    expect(/UPDATE group_students SET ([\s\S]+?) WHERE/.exec(repo)![1]).not.toMatch(/(?:^|,\s*)(group_id|student_id|school_id|organization_id|assigned_at|assigned_by)\s*=/);
  });

  it('stores no schedule and nothing about students (their data belongs to Module 19), and has no login concept', () => {
    for (const f of files.filter((x) => /\/(domain|infrastructure)\//.test(where(x)))) {
      expect([path.basename(f), /schedule|national_?id|full_?name|parent_?id|password|hasher|token/i.test(stripFile(f))]).toEqual([path.basename(f), false]);
    }
    const migration = strip(read('database/migrations/20261021100000-create-groups.js'));
    expect(migration).not.toMatch(/schedule|national_id|full_name|parent_id|password/i);
  });

  it('the migration: one ACTIVE name per school and one CURRENT group per student, RESTRICT keys to its own table only, no foreign key to another module', () => {
    const migration = read('database/migrations/20261021100000-create-groups.js');
    expect(migration).toMatch(/addIndex\('school_groups', \['school_id', 'name_key', 'active'\], \{ unique: true/);
    expect(migration).toMatch(/addIndex\('group_students', \['student_id', 'active'\], \{ unique: true/);
    expect([...migration.matchAll(/references: \{ model: '([a-z_]+)'/g)].map((m) => m[1])).toEqual(['school_groups', 'school_groups']);
    expect(migration).toMatch(/ck_school_groups_surah/);
  });

  it('the temporary "no groups yet" stand-ins are GONE: the real Groups guard and access are wired, and the consumer is registered', () => {
    const teachers = read('src/config/teachers.ts');
    const students = read('src/config/students.ts');
    const groups = read('src/config/groups.ts');
    expect(teachers).not.toMatch(/GROUPS_MODULE_NOT_IMPLEMENTED_YET/);
    expect(teachers).toMatch(/getGroupService\(\)\.countGroupsOfTeacherInSchool/);
    expect(students).not.toMatch(/GROUPS_MODULE_NOT_IMPLEMENTED_YET/);
    expect(students).toMatch(/getGroupService\(\)\.isStudentInGroupOfTeacher/);
    expect(groups).toMatch(/getEventHandlerRegistry\(\)\.register\(createStudentArchivedHandler/);
  });
});
