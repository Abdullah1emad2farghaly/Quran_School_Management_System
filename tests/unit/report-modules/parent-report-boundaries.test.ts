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
const BUILDER = 'modules/38-report-modules/application/services/parent-report-builder.ts';
const SOURCES = 'modules/38-report-modules/infrastructure/services/public-parent-report-sources.ts';

describe('PARENT report (Module 38 slice 6): module boundaries', () => {
  it('the Parent sources read other modules only through their public contracts (Modules 16, 17 and 19)', () => {
    for (const file of [SOURCES, 'modules/38-report-modules/application/ports/parent-report-sources.ts']) {
      const specs = [...read(file).matchAll(/from '([^']+)'/g)].map((m) => m[1]!).filter((s) => /\/\d{2}-[a-z-]+\//.test(s));
      expect(specs.length, file).toBeGreaterThan(0);
      expect(specs.filter((s) => !/\/\d{2}-[a-z-]+\/public$/.test(s)), file).toEqual([]);
    }
    const sources = read(SOURCES);
    for (const moduleNumber of ['16-schools', '17-parents', '19-students']) expect(sources).toContain(`/${moduleNumber}/public`);
  });

  it('the report never writes and never touches a lifecycle or a permission', () => {
    const code = stripComments(read(SOURCES)) + stripComments(read(BUILDER));
    expect(/\.(create|update|save|delete|remove|archive|activate|deactivate|assign|unassign|register|link|unlink|record|submit)[A-Z(]/.test(code)).toBe(false);
    expect(/archiv|activat|deactivat|reactivat|status\s*=(?!=)|permission|policy|policies/i.test(code)).toBe(false);
  });

  it('the authorization chain runs before any child or Parent data is read', () => {
    const code = stripComments(read(BUILDER));
    const authorize = code.indexOf("deps.scopes.authorize(requester, 'PARENT')");
    const period = code.indexOf('deps.periods.resolvePeriod');
    const firstRead = Math.min(...['sources.parentOfUser(', 'sources.childrenOfParent(', 'sources.parentName(', 'deps.studentReport('].map((token) => code.indexOf(token)));
    expect(authorize).toBeGreaterThan(-1);
    expect(authorize).toBeLessThan(period);
    expect(period).toBeLessThan(firstRead);
    // the name of the Parent is read only AFTER the scope proof (children found / links) and the child reports only after that
    expect(code.indexOf('sources.parentName(')).toBeGreaterThan(code.indexOf('REPORT_SCOPE_FORBIDDEN'));
    expect(code.indexOf('deps.studentReport(')).toBeGreaterThan(code.indexOf('sources.parentName('));
  });

  it('a Parent\'s own record comes from the verified account, never from the request; a manager must name the Parent', () => {
    const code = stripComments(read(BUILDER));
    expect(code).toContain('sources.parentOfUser(requester.userId)');
    expect(code).toMatch(/!own \|\| \(request\.parentId !== undefined && request\.parentId !== own\.id\)\) throw forbidden\(\)/);
    expect(code).toContain("new ValidationError([{ field: 'parentId', code: 'REQUIRED_FIELD' }])");
  });

  it('every child is reported by the STUDENT report (same authorization, same rules): nothing is recomputed or invented here', () => {
    const code = stripComments(read(BUILDER));
    expect(code).toMatch(/deps\.studentReport\(requester, \{ period: request\.period, studentId: child\.id \}\)/);
    expect(/percent|ranking|\brank\b|grade|weight|overall|composite|Math\.(round|floor|ceil)|\.reduce\(/i.test(code)).toBe(false);
  });

  it('the Parent header holds the name and the children only (no phone, address, status)', () => {
    const dto = stripComments(read('modules/38-report-modules/application/dto/parent-report.ts'));
    expect(/phone|address|status|email/i.test(dto)).toBe(false);
    const block = dto.slice(dto.indexOf('export interface ParentReportParent'), dto.indexOf('export interface ParentReport {'));
    expect(block).toMatch(/readonly id: string;[\s\S]*readonly name: string;[\s\S]*readonly children: readonly ParentReportChildRef\[\];/);
  });
});

describe('Module 19 additive read contract for the Parent report', () => {
  const service = () => stripComments(read('modules/19-students/application/services/student-service.ts'));
  const body = () => {
    const text = service();
    const start = text.indexOf('async listChildrenOfParentForReport(');
    expect(start).toBeGreaterThan(-1);
    return text.slice(start, text.indexOf('async findById(', start));
  };

  it('is read-only and never filters or returns the lifecycle status', () => {
    const text = body();
    expect(/\.(insert|update|insertHistory|lockById)\(/.test(text)).toBe(false);
    expect(/status/i.test(text)).toBe(false);
    expect(text).toContain('this.students.listByParentInSchools(');
    expect(text).toContain('this.students.listByParent(');
  });

  it('adds no permission, no route and no event; Module 19 does not depend on Module 38', () => {
    const presentation = sourceFiles(path.join(src, 'modules/19-students/presentation')).map((f) => readFileSync(f, 'utf8')).join('\n');
    expect(presentation).not.toMatch(/ForReport/);
    const imports = sourceFiles(path.join(src, 'modules/19-students')).flatMap((f) => [...readFileSync(f, 'utf8').matchAll(/from '([^']+)'/g)].map((m) => m[1]!));
    expect(imports.filter((s) => /\/38-report-modules\//.test(s))).toEqual([]);
  });

  it('no migration was added', () => {
    const migrations = readdirSync(path.resolve(__dirname, '../../../database/migrations'));
    expect(migrations.filter((m) => /parent-report/i.test(m))).toEqual([]);
    expect(migrations).toHaveLength(50);
  });
});
