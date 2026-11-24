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
const BUILDER = 'modules/38-report-modules/application/services/teacher-report-builder.ts';
const SOURCES = 'modules/38-report-modules/infrastructure/services/public-teacher-report-sources.ts';
const PORT = 'modules/38-report-modules/application/ports/teacher-report-sources.ts';
const DTO = 'modules/38-report-modules/application/dto/teacher-report.ts';

describe('TEACHER report (Module 38 slice 8): module boundaries', () => {
  it('the Teacher sources read other modules only through their public contracts (Modules 16, 18 and 20)', () => {
    for (const file of [SOURCES, PORT]) {
      const specs = [...read(file).matchAll(/from '([^']+)'/g)].map((m) => m[1]!).filter((s) => /\/\d{2}-[a-z-]+\//.test(s));
      expect(specs.length, file).toBeGreaterThan(0);
      expect(specs.filter((s) => !/\/\d{2}-[a-z-]+\/public$/.test(s)), file).toEqual([]);
    }
    const sources = read(SOURCES);
    for (const moduleNumber of ['16-schools', '18-teachers', '20-groups']) expect(sources).toContain(`/${moduleNumber}/public`);
  });

  it('the report never writes and never touches a lifecycle or a permission', () => {
    const code = stripComments(read(SOURCES)) + stripComments(read(BUILDER));
    expect(/\.(create|update|save|delete|remove|archive|activate|deactivate|assign|unassign|register|link|unlink|record|submit)[A-Z(]/.test(code)).toBe(false);
    expect(/archiv|activat|deactivat|reactivat|status\s*=(?!=)|permission|policy|policies/i.test(code)).toBe(false);
  });

  it('authorization and the school scope come first: no Teacher, group or figure is read before them', () => {
    const code = stripComments(read(BUILDER));
    const authorize = code.indexOf("deps.scopes.authorize(requester, 'TEACHER')");
    const period = code.indexOf('deps.periods.resolvePeriod');
    const kind = code.indexOf("scope.kind !== 'ORGANIZATIONS' && scope.kind !== 'SCHOOLS'");
    const authorizedSchools = code.indexOf('const authorizedSchools');
    const proof = code.indexOf('throw forbidden()');
    const firstRead = Math.min(...['sources.teacherName(', 'sources.schoolNames(', 'delegates.groupReport(', 'delegates.attendanceReport('].map((token) => code.indexOf(token)));
    expect(authorize).toBeGreaterThan(-1);
    expect(authorize).toBeLessThan(period);
    expect(period).toBeLessThan(kind);
    expect(kind).toBeLessThan(authorizedSchools);
    expect(authorizedSchools).toBeLessThan(proof);
    expect(proof).toBeLessThan(firstRead);
  });

  it('EVERY read of groups is given ONLY the requester\'s authorized schools (never the Teacher\'s own school list)', () => {
    const code = stripComments(read(BUILDER));
    const calls = code.split('sources.taughtGroups(').slice(1).map((rest) => rest.slice(0, 60));
    expect(calls).toHaveLength(2);
    for (const call of calls) expect(call).toContain('{ teacherId, schoolIds: authorizedSchools');
    // the Teacher's current links are used only after being intersected with the authorized schools
    expect(code).toMatch(/\(await sources\.activeSchoolIdsOfTeacher\(teacherId\)\)\.filter\(\(id\) => authorizedSchools\.includes\(id\)\)/);
    expect(code).not.toMatch(/schoolIds: (linked|all)/);
  });

  it('the figures are the existing GROUP and ATTENDANCE reports for exactly the stint\'s dates (nothing recomputed here)', () => {
    const code = stripComments(read(BUILDER));
    expect(code).toContain("const stintPeriod = { kind: 'CUSTOM', startDate: taughtFrom,");
    expect(code).toContain('delegates.groupReport(requester, base)');
    expect(code).toContain('delegates.attendanceReport(requester, base)');
    expect(code).toContain("row.subjectType === 'TEACHER' && row.subjectId === teacherId");
  });

  it('invents no score, ranking, weighting, comparison or total across groups and schools, and holds no financial or contact data', () => {
    for (const file of [DTO, BUILDER, SOURCES, PORT]) {
      const text = stripComments(read(file)).replace(/^import .*$/gm, '');
      expect(/percent|ranking|\brank\b|grade|weight|overall|composite|best|worst/i.test(text), file).toBe(false);
      expect(/subscription|payment|paid|unpaid|waive|financ|invoice|phone|email|address|mobile/i.test(text), file).toBe(false);
    }
    expect(/Math\.(round|floor|ceil|sqrt|pow)|average\s*[+*/]/.test(stripComments(read(BUILDER)))).toBe(false);
  });
});

describe('Module 20 additive read contract for the Teacher report', () => {
  const GROUP_REPO = 'modules/20-groups/infrastructure/persistence/sequelize/repositories/sequelize-group-repository.ts';

  it('the SQL is a single read, restricted to the given schools, and writes nothing', () => {
    const text = stripComments(read(GROUP_REPO));
    const start = text.indexOf('async listTeacherTimelinesForReport(');
    expect(start).toBeGreaterThan(-1);
    const body = text.slice(start, text.indexOf('async isStudentInActiveGroupOfTeacher(', start));
    expect(body).toContain('g.school_id IN (:schoolIds)');
    expect(body).toContain('if (query.schoolIds.length === 0) return [];');
    expect(/\b(INSERT|UPDATE|DELETE|REPLACE|ALTER|DROP)\b/i.test(body)).toBe(false);
  });

  it('the stints come from the history alone: the service reads no current group owner', () => {
    const text = stripComments(read('modules/20-groups/application/services/group-service.ts'));
    const start = text.indexOf('async listGroupsTaughtByTeacherForReport(');
    expect(start).toBeGreaterThan(-1);
    const body = text.slice(start, text.indexOf('async listAssignmentHistoryOfStudent(', start));
    expect(body).toContain('this.groups.listTeacherTimelinesForReport(');
    expect(body).toContain('teachingStints(');
    expect(/snapshot\.teacherId|\.teacherId\s*===|listByTeacher|findByTeacher/.test(body)).toBe(false);
  });

  it('the domain function is pure (no framework, no clock, no I/O)', () => {
    const text = stripComments(read('modules/20-groups/domain/services/teaching-stints.ts'));
    expect(/from '(?!\.)/.test(text)).toBe(false);
    expect(/new Date\(\)|Date\.now|await |async /.test(text)).toBe(false);
  });

  it('adds no permission, no route and no event; Module 20 does not depend on Module 38; no migration', () => {
    const presentation = sourceFiles(path.join(src, 'modules/20-groups/presentation')).map((f) => readFileSync(f, 'utf8')).join('\n');
    expect(presentation).not.toMatch(/ForReport/);
    const imports = sourceFiles(path.join(src, 'modules/20-groups')).flatMap((f) => [...readFileSync(f, 'utf8').matchAll(/from '([^']+)'/g)].map((m) => m[1]!));
    expect(imports.filter((s) => /\/38-report-modules\//.test(s))).toEqual([]);
    const migrations = readdirSync(path.resolve(__dirname, '../../../database/migrations'));
    expect(migrations.filter((m) => /teacher-report/i.test(m))).toEqual([]);
    expect(migrations).toHaveLength(50);
  });
});
