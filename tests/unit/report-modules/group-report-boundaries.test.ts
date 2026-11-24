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
const BUILDER = 'modules/38-report-modules/application/services/group-report-builder.ts';
const SOURCES = 'modules/38-report-modules/infrastructure/services/public-group-report-sources.ts';
const DTO = 'modules/38-report-modules/application/dto/group-report.ts';

describe('GROUP report (Module 38 slice 7): module boundaries', () => {
  it('the Group sources read other modules only through their public contracts (Modules 16, 19, 20 and 30)', () => {
    for (const file of [SOURCES, 'modules/38-report-modules/application/ports/group-report-sources.ts']) {
      const specs = [...read(file).matchAll(/from '([^']+)'/g)].map((m) => m[1]!).filter((s) => /\/\d{2}-[a-z-]+\//.test(s));
      expect(specs.length, file).toBeGreaterThan(0);
      expect(specs.filter((s) => !/\/\d{2}-[a-z-]+\/public$/.test(s)), file).toEqual([]);
    }
    const sources = read(SOURCES);
    for (const moduleNumber of ['16-schools', '19-students', '20-groups', '30-exams']) expect(sources).toContain(`/${moduleNumber}/public`);
  });

  it('the report never writes and never touches a lifecycle or a permission', () => {
    const code = stripComments(read(SOURCES)) + stripComments(read(BUILDER));
    expect(/\.(create|update|save|delete|remove|archive|activate|deactivate|assign|unassign|register|record|submit)[A-Z(]/.test(code)).toBe(false);
    expect(/archiv|activat|deactivat|reactivat|status\s*=(?!=)|permission|policy|policies/i.test(code)).toBe(false);
  });

  it('the authorization chain runs before any group data is read', () => {
    const code = stripComments(read(BUILDER));
    const authorize = code.indexOf("deps.scopes.authorize(requester, 'GROUP')");
    const period = code.indexOf('deps.periods.resolvePeriod');
    const proof = code.indexOf('restrictToScope(scope');
    const firstRead = Math.min(...['sources.schoolIdOfGroup(', 'sources.groupHeader(', 'sources.roster(', 'sources.studentFacts(', 'sources.examOutcomes(', 'delegates.'].map((token) => code.indexOf(token)));
    expect(authorize).toBeGreaterThan(-1);
    expect(authorize).toBeLessThan(period);
    expect(period).toBeLessThan(proof);
    expect(proof).toBeLessThan(firstRead);
    // a Teacher's group proof (a SAME-dimension request must be one of their current groups) and the manager's school proof both come before the header, the roster and the figures
    expect(code.indexOf('sources.groupHeader(')).toBeGreaterThan(code.indexOf('REPORT_NOT_ALLOWED'));
    expect(code.indexOf('sources.roster(')).toBeGreaterThan(code.indexOf('sources.groupHeader('));
  });

  it('the roster is the authoritative assignment history of the period, never rebuilt from the current roster', () => {
    const code = stripComments(read(BUILDER)) + stripComments(read(SOURCES));
    expect(code).toContain('sources.roster(');
    expect(code).toContain('listAssignmentsOfGroupForReport');
    expect(/listCurrent|listStudentsOfGroup|listGroupStudents|currentRoster/i.test(code)).toBe(false);
  });

  it('the four learning figures are the existing reports, called unchanged for the group', () => {
    const code = stripComments(read(BUILDER));
    for (const method of ['attendanceReport', 'memorizationReport', 'revisionReport', 'evaluationReport']) expect(code).toContain(`delegates.${method}(requester, base)`);
    expect(code).toContain('const base = { period: request.period, groupId };');
  });

  it('contains no financial data at all (subscriptions, payments)', () => {
    for (const file of [DTO, BUILDER, SOURCES, 'modules/38-report-modules/application/ports/group-report-sources.ts']) {
      // import lines are ignored: `ReportPeriodDto` simply lives in `payment-report.ts`
      expect(/subscription|payment|paid|unpaid|waive|financ|invoice/i.test(stripComments(read(file)).replace(/^import .*$/gm, '')), file).toBe(false);
    }
  });

  it('invents no score, grade, percentage, ranking, weighting or combined formula: only counts and the existing per-category means', () => {
    const dto = stripComments(read(DTO));
    const builder = stripComments(read(BUILDER));
    expect(/percent|ranking|\brank\b|grade|weight|overall|composite|best|worst/i.test(dto + builder)).toBe(false);
    expect(/Math\.(round|floor|ceil|sqrt|pow)|average\s*[+*/]|\/\s*count/.test(builder)).toBe(false);
  });

  it('the Teacher\'s attendance exists only for the managers (the ATTENDANCE report shows a Teacher students only)', () => {
    const code = stripComments(read(BUILDER));
    expect(code).toMatch(/\.\.\.\(managerScope \? \{ teacherAttendance:/);
    expect(code).toMatch(/managerScope = true;/);
  });

  it('the group header carries the Teacher\'s name only (no phone, email or address)', () => {
    expect(/phone|email|address|mobile/i.test(stripComments(read(DTO)) + stripComments(read(SOURCES)))).toBe(false);
  });
});

describe('Module 20 additive read contract for the Group report', () => {
  it('the SQL is a single read over group_students and writes nothing', () => {
    const text = stripComments(read('modules/20-groups/infrastructure/persistence/sequelize/repositories/sequelize-group-repository.ts'));
    const start = text.indexOf('async listAssignmentsOfGroupForReport(');
    expect(start).toBeGreaterThan(-1);
    const body = text.slice(start, text.indexOf('async isStudentInActiveGroupOfTeacher(', start));
    expect(body).toContain('this.assignmentsWhere(');
    expect(/\b(INSERT|UPDATE|DELETE|REPLACE|ALTER|DROP)\b/i.test(body)).toBe(false);
  });

  it('adds no permission, no route and no event; Module 20 does not depend on Module 38', () => {
    const presentation = sourceFiles(path.join(src, 'modules/20-groups/presentation')).map((f) => readFileSync(f, 'utf8')).join('\n');
    expect(presentation).not.toMatch(/ForReport/);
    const imports = sourceFiles(path.join(src, 'modules/20-groups')).flatMap((f) => [...readFileSync(f, 'utf8').matchAll(/from '([^']+)'/g)].map((m) => m[1]!));
    expect(imports.filter((s) => /\/38-report-modules\//.test(s))).toEqual([]);
  });

  it('no migration was added: the read uses the existing group_students table and ix_group_students_group', () => {
    const migrations = readdirSync(path.resolve(__dirname, '../../../database/migrations'));
    expect(migrations.filter((m) => /group-report/i.test(m))).toEqual([]);
    expect(migrations).toHaveLength(50);
    expect(readFileSync(path.resolve(__dirname, '../../../database/migrations/20261021100000-create-groups.js'), 'utf8')).toContain('ix_group_students_group');
  });
});
