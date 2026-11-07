import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { registerAllErrorMessages } from '../../../src/app/bootstrap/register-error-messages';
import { defaultMessageCatalog } from '../../../src/modules/03-error-localization/public';
import { EXAM_ERROR_MESSAGES, ExamErrorCodes, ExamPermissions } from '../../../src/modules/30-exams/public';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? sourceFiles(full) : full.endsWith('.ts') ? [full] : [];
  });
}
const strip = (text: string) => text.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');
const SRC = path.resolve(__dirname, '../../../src');
const MODULE = path.join(SRC, 'modules/30-exams');
const files = sourceFiles(MODULE);
const imports = files.flatMap((file) => [...strip(readFileSync(file, 'utf8')).matchAll(/from '([^']+)'/g)].map((m) => ({ file, spec: m[1]! })));
const code = files.map((f) => strip(readFileSync(f, 'utf8'))).join('\n');
const repoSql = strip(readFileSync(path.join(MODULE, 'infrastructure/persistence/sequelize/repositories/sequelize-exam-repository.ts'), 'utf8'));

describe('Module 30 error messages', () => {
  it('has Arabic and English text for every code, and nothing else; all are registered', () => {
    expect(EXAM_ERROR_MESSAGES.map((m) => m.code).sort()).toEqual(Object.values(ExamErrorCodes).sort());
    for (const m of EXAM_ERROR_MESSAGES) { expect(m.message.ar.length).toBeGreaterThan(0); expect(m.message.en.length).toBeGreaterThan(0); }
    registerAllErrorMessages();
    for (const c of Object.values(ExamErrorCodes)) expect(defaultMessageCatalog.has(c), c).toBe(true);
    expect(defaultMessageCatalog.message('EXAM_SCORE_OUT_OF_RANGE', 'en', { question: 2, max: 10 })).toContain('question 2');
  });
});

describe('Module 30 boundaries', () => {
  it('imports other modules only through their public contract, and only lower-numbered modules', () => {
    expect(imports.filter(({ spec }) => /\/\d{2}-[a-z-]+\//.test(spec) && !/\/\d{2}-[a-z-]+\/public$/.test(spec))).toEqual([]);
    expect(imports.filter(({ spec }) => { const m = /\/(\d{2})-[a-z-]+\/public$/.exec(spec); return m !== null && Number(m[1]) >= 30; })).toEqual([]);
  });

  it('never touches another module\'s tables, repositories or models', () => {
    expect(code).not.toMatch(/\b(?:FROM|JOIN|INTO|UPDATE)\s+(?:students|teachers|parents|groups|group_|class_sessions|attendance_|memorization_|revision_|evaluation|schools)/i);
    expect(code).not.toMatch(/GroupRepository|StudentRepository|TeacherRepository|ParentRepository/);
  });

  it('contains NO notification delivery and NO dependency on Modules 31-40 (events only)', () => {
    expect(imports.filter(({ spec }) => /\/(3[1-9]|40)-/.test(spec))).toEqual([]);
    expect(code).not.toMatch(/NotificationService|sendNotification|NotificationSender/i);
  });

  it('a result is NEVER updated or deleted: no UPDATE/DELETE on exam_results or exam_result_scores exists anywhere, and the result aggregate has no mutator', () => {
    expect(repoSql).not.toMatch(/UPDATE\s+exam_results|UPDATE\s+exam_result_scores|DELETE\s+FROM\s+exam_results|DELETE\s+FROM\s+exam_result_scores|TRUNCATE|DROP\s+TABLE/i);
    expect(repoSql).not.toMatch(/ON DUPLICATE KEY UPDATE[^`']*(?:score|total)/i);
    expect(repoSql).not.toMatch(/REPLACE\s+INTO/i);
  });

  it('exams are never physically deleted (deletion is a soft delete), and the only DELETE is the exam\'s own group list that is rewritten on save', () => {
    const deletes = [...repoSql.matchAll(/DELETE\s+FROM\s+([a-z_]+)/gi)].map((m) => m[1]);
    expect(deletes).toEqual(['exam_groups']);
  });

  it('only exam_students.status ever changes in a target row', () => {
    const updates = [...repoSql.matchAll(/UPDATE\s+exam_students\s+SET\s+([^\s]+)/gi)].map((m) => m[1]);
    expect(updates.every((u) => u === 'status')).toBe(true);
  });

  it('the route table: no result edit or delete, no examiner result read, no exam physical delete beyond DELETE /:id (soft)', () => {
    const routes = strip(readFileSync(path.join(MODULE, 'presentation/http/exam-routes.ts'), 'utf8'));
    const declared = [...routes.matchAll(/router\.(get|post|put|patch|delete)\(\s*'([^']+)'/g)].map((m) => `${m[1]!.toUpperCase()} ${m[2]}`);
    expect(declared.filter((d) => /results/.test(d)).sort()).toEqual(['GET /:id/results', 'POST /:id/results']);
    expect(declared.some((d) => /^(PUT|PATCH|DELETE) .*results/.test(d))).toBe(false);
    expect(declared.filter((d) => d.startsWith('DELETE'))).toEqual(['DELETE /:id', 'DELETE /:id/examiners/:teacherId']);
  });

  it('the only permission that can read results is the School Manager\'s; the examiner permission only records', () => {
    expect(Object.values(ExamPermissions).sort()).toEqual([
      'exam.assigned.read', 'exam.examiner.manage', 'exam.exam.create', 'exam.exam.lifecycle', 'exam.exam.list', 'exam.exam.read', 'exam.exam.update', 'exam.result.read', 'exam.result.record', 'exam.schedule.read', 'exam.student.read',
    ].sort());
    const auth = strip(readFileSync(path.join(MODULE, 'application/services/exam-authorization.ts'), 'utf8'));
    expect(auth).toMatch(/READ_RESULTS\][\s\S]*?roles: manager/);
    expect(auth).toMatch(/code: ExamPermissions\.RECORD_RESULT, roles: \['TEACHER'\]/);
    expect(auth).not.toMatch(/role(s)?: \[[^\]]*(ORGANIZATION_MANAGER|MAIN_ADMIN|STUDENT)/);
  });

  it('the exam-scoped permission never creates, changes or removes a role (no role or membership module is imported)', () => {
    expect(imports.filter(({ spec }) => /(11-roles|09-roles|-roles\/public)/.test(spec))).toEqual([]);
    expect(code).not.toMatch(/assignRole|revokeRole|removeRole|grantRole|user_roles/i);
  });

  it('lower modules never import Module 30; only the composition root wires it', () => {
    for (const dir of readdirSync(path.join(SRC, 'modules')).filter((d) => /^\d{2}-/.test(d) && Number(d.slice(0, 2)) < 30)) {
      expect(sourceFiles(path.join(SRC, 'modules', dir)).map((f) => readFileSync(f, 'utf8')).join('\n'), dir).not.toMatch(/30-exams/);
    }
  });

  it('the scheduler is started from the server entry point, and the group membership handler is registered there too', () => {
    const server = readFileSync(path.join(SRC, 'app/server.ts'), 'utf8');
    expect(server).toMatch(/registerExamEventHandlers\(\);/);
    expect(server).toMatch(/startExamScheduler\(\);/);
    expect(server).toMatch(/stopExamScheduler\(\);/);
  });
});
