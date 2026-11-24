import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const src = path.resolve(__dirname, '../../../src');
const read = (relative: string) => readFileSync(path.join(src, relative), 'utf8');
const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const sourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? sourceFiles(full) : full.endsWith('.ts') ? [full] : [];
  });
/** The text of one method of a class source (from its signature to the next method at the same indent). */
const methodBody = (text: string, signature: string): string => {
  const start = text.indexOf(signature);
  expect(start, `${signature} exists`).toBeGreaterThan(-1);
  const rest = text.slice(start);
  const next = rest.slice(signature.length).search(/\n {2}(?:async |private |public )?[a-zA-Z]+\(|\n {2}\/\*\*/);
  return next === -1 ? rest : rest.slice(0, signature.length + next);
};

describe('STUDENT report (Module 38 slice 5): module boundaries', () => {
  it('the student sources read other modules only through their public contracts', () => {
    const files = ['modules/38-report-modules/infrastructure/services/public-student-report-sources.ts', 'modules/38-report-modules/application/ports/student-report-sources.ts'];
    for (const file of files) {
      const specs = [...read(file).matchAll(/from '([^']+)'/g)].map((m) => m[1]!).filter((s) => /\/\d{2}-[a-z-]+\//.test(s));
      expect(specs.length, file).toBeGreaterThan(0);
      expect(specs.filter((s) => !/\/\d{2}-[a-z-]+\/public$/.test(s)), file).toEqual([]);
    }
    const sources = read(files[0]!);
    for (const moduleNumber of ['16-schools', '18-teachers', '19-students', '20-groups', '30-exams', '33-subscriptions']) expect(sources).toContain(`/${moduleNumber}/public`);
  });

  it('the report never writes: the student sources and the builder call no mutating method of any module', () => {
    const code = stripComments(read('modules/38-report-modules/infrastructure/services/public-student-report-sources.ts')) + stripComments(read('modules/38-report-modules/application/services/student-report-builder.ts'));
    expect(/\.(create|update|save|delete|remove|archive|activate|deactivate|assign|unassign|record|submit|markPaid|waive|reverse|pay)[A-Z(]/.test(code)).toBe(false);
  });

  it('the report never changes a student: nothing in the student report code touches the lifecycle', () => {
    const code = stripComments(read('modules/38-report-modules/infrastructure/services/public-student-report-sources.ts')) + stripComments(read('modules/38-report-modules/application/services/student-report-builder.ts'));
    expect(/archiv|activat|deactivat|reactivat|status\s*=(?!=)/i.test(code.replace(/\bscope\.kind\b/g, ''))).toBe(false);
  });

  it('only the Organization Manager and the School Manager can receive the subscription section', () => {
    const code = stripComments(read('modules/38-report-modules/application/services/student-report-builder.ts'));
    expect(code).toContain("const SUBSCRIPTION_ROLES: readonly string[] = ['ORGANIZATION_MANAGER', 'SCHOOL_MANAGER']");
    expect(code).toMatch(/canSeeSubscriptions\s*=\s*SUBSCRIPTION_ROLES\.includes\(requester\.activeRole\)/);
    expect(code).toMatch(/canSeeSubscriptions\s*&&\s*!isEmpty/);
  });

  it('the authorization chain runs before any data is read', () => {
    const code = stripComments(read('modules/38-report-modules/application/services/student-report-builder.ts'));
    const authorize = code.indexOf("deps.scopes.authorize(requester, 'STUDENT')");
    const scopeProof = code.indexOf('restrictToScope(scope');
    const firstRead = Math.min(...['studentFacts(', 'examOutcomes(', 'subscriptions(', 'assignmentHistoryOfStudent(', 'delegates.'].map((token) => code.indexOf(`sources.${token}`) >= 0 ? code.indexOf(`sources.${token}`) : code.indexOf(token)));
    expect(authorize).toBeGreaterThan(-1);
    expect(authorize).toBeLessThan(scopeProof);
    expect(scopeProof).toBeLessThan(firstRead);
  });

  it('invents no score, grade, percentage, ranking, weight or combined formula', () => {
    const dto = stripComments(read('modules/38-report-modules/application/dto/student-report.ts'));
    const builder = stripComments(read('modules/38-report-modules/application/services/student-report-builder.ts'));
    expect(/percent|ranking|\brank\b|grade|weight|overall|composite/i.test(dto + builder)).toBe(false);
    expect(/Math\.(round|floor|ceil)|\.reduce\(/.test(builder)).toBe(false);
  });
});

describe('Module 30 and Module 33 additive read contracts for the Student report', () => {
  it('the Module 30 repository method is a read: one SELECT path, no write statement', () => {
    const sequelize = stripComments(read('modules/30-exams/infrastructure/persistence/sequelize/repositories/sequelize-exam-repository.ts'));
    const body = methodBody(sequelize, 'async listOutcomesOfStudentForReport(');
    expect(body).toMatch(/SELECT/);
    expect(/\b(INSERT|UPDATE|DELETE|REPLACE|ALTER|DROP)\b/i.test(body)).toBe(false);
  });

  it('the Module 33 repository method is a read: one SELECT, no write statement', () => {
    const sequelize = stripComments(read('modules/33-subscriptions/infrastructure/persistence/sequelize/repositories/sequelize-subscription-repository.ts'));
    const body = methodBody(sequelize, 'async listForStudentReport(');
    expect(body).toMatch(/SELECT/);
    expect(/\b(INSERT|UPDATE|DELETE|REPLACE|ALTER|DROP)\b/i.test(body)).toBe(false);
  });

  it('neither new method is reachable over HTTP and neither adds a permission: Module 33 authorization is unchanged', () => {
    for (const moduleDir of ['30-exams', '33-subscriptions']) {
      const presentation = sourceFiles(path.join(src, 'modules', moduleDir, 'presentation')).map((f) => readFileSync(f, 'utf8')).join('\n');
      expect(presentation, moduleDir).not.toMatch(/ForReport/);
    }
    const subscriptionService = stripComments(read('modules/33-subscriptions/application/services/subscription-service.ts'));
    expect(methodBody(subscriptionService, 'listStudentSubscriptionsForReport(')).not.toMatch(/permission|authorize|requireRole/i);
  });

  it('Module 30 and Module 33 do not depend on Module 38 (the dependency points one way)', () => {
    for (const moduleDir of ['30-exams', '33-subscriptions']) {
      const imports = sourceFiles(path.join(src, 'modules', moduleDir)).flatMap((f) => [...readFileSync(f, 'utf8').matchAll(/from '([^']+)'/g)].map((m) => m[1]!));
      expect(imports.filter((s) => /\/38-report-modules\//.test(s)), moduleDir).toEqual([]);
    }
  });

  it('no migration was added: the new reads use the existing tables and student indexes', () => {
    const migrations = readdirSync(path.resolve(__dirname, '../../../database/migrations'));
    expect(migrations.filter((m) => /student-report/i.test(m))).toEqual([]);
    const exams = readFileSync(path.resolve(__dirname, '../../../database/migrations/20261104100000-create-exams.js'), 'utf8');
    expect(exams).toContain('ix_exam_students_student');
  });
});
