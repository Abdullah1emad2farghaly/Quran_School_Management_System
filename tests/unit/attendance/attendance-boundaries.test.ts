import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { registerAllErrorMessages } from '../../../src/app/bootstrap/register-error-messages';
import { defaultMessageCatalog } from '../../../src/modules/03-error-localization/public';
import { ATTENDANCE_ERROR_MESSAGES, AttendanceErrorCodes } from '../../../src/modules/26-attendance/public';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? sourceFiles(full) : full.endsWith('.ts') ? [full] : [];
  });
}
const strip = (text: string) => text.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');
const MODULE = path.resolve(__dirname, '../../../src/modules/26-attendance');
const files = sourceFiles(MODULE);
const read = (rel: string) => strip(readFileSync(path.join(MODULE, rel), 'utf8'));
const imports = files.flatMap((file) => [...readFileSync(file, 'utf8').matchAll(/from '([^']+)'/g)].map((m) => ({ file, spec: m[1]! })));

describe('Attendance error messages', () => {
  it('has Arabic and English text for every code, and nothing else', () => {
    expect(ATTENDANCE_ERROR_MESSAGES.map((m) => m.code).sort()).toEqual(Object.values(AttendanceErrorCodes).sort());
    for (const m of ATTENDANCE_ERROR_MESSAGES) {
      expect(m.message.ar.length).toBeGreaterThan(0);
      expect(m.message.en.length).toBeGreaterThan(0);
    }
  });
  it('are registered with the application', () => {
    registerAllErrorMessages();
    for (const c of Object.values(AttendanceErrorCodes)) expect(defaultMessageCatalog.has(c), c).toBe(true);
  });
});

describe('Attendance boundaries', () => {
  it('imports other modules only through their public contract, and only lower-numbered modules', () => {
    expect(imports.filter(({ spec }) => /\/\d{2}-[a-z-]+\//.test(spec) && !/\/\d{2}-[a-z-]+\/public$/.test(spec))).toEqual([]);
    expect(imports.filter(({ spec }) => { const m = /\/(\d{2})-[a-z-]+\/public$/.exec(spec); return m !== null && Number(m[1]) >= 26; })).toEqual([]);
  });

  it('its code dependencies are exactly Modules 00, 02, 03, 04, 06, 12, 16, 18, 19, 20, 24 and 25 (no notification, audit or teaching-record module)', () => {
    const used = new Set(imports.map(({ spec }) => /\/(\d{2})-[a-z-]+\/public$/.exec(spec)?.[1]).filter(Boolean));
    expect([...used].sort()).toEqual(['00', '02', '03', '04', '06', '12', '16', '18', '19', '20', '24', '25']);
  });

  it('reads and writes only its own two tables', () => {
    const tables = new Set<string>();
    for (const f of files) for (const m of strip(readFileSync(f, 'utf8')).matchAll(/\b(?:FROM|INTO|UPDATE|JOIN)\s+([a-z_]+)/g)) tables.add(m[1]!);
    expect([...tables].sort()).toEqual(['attendance_correction_history', 'attendance_records']);
  });

  it('never deletes: no DELETE / TRUNCATE / DROP / destroy anywhere in the module', () => {
    for (const f of files) expect(strip(readFileSync(f, 'utf8')), f).not.toMatch(/\bDELETE\s+FROM\b|\.destroy\(|\bTRUNCATE\b|\bDROP\s+TABLE\b/i);
  });

  it('the correction history is APPEND-ONLY: it is only ever INSERTed into (no UPDATE, no DELETE of attendance_correction_history)', () => {
    for (const f of files) {
      const code = strip(readFileSync(f, 'utf8'));
      expect(code, f).not.toMatch(/UPDATE\s+attendance_correction_history/i);
      expect(code, f).not.toMatch(/DELETE\s+FROM\s+attendance_correction_history/i);
    }
    expect(read('infrastructure/persistence/sequelize/repositories/sequelize-attendance-repository.ts')).toMatch(/INSERT INTO attendance_correction_history/);
  });

  it('is deterministic apart from the injected clock: no Date.now / new Date() / Math.random', () => {
    for (const f of files) expect(strip(readFileSync(f, 'utf8')), f).not.toMatch(/\b(Date\.now|new Date\(\s*\)|Math\.random)/);
  });

  it('the ONE automatic rule: no timer, job or scheduler; a single event handler that only ever touches the TEACHER subject (students are never marked automatically)', () => {
    for (const f of files) expect(strip(readFileSync(f, 'utf8')), f).not.toMatch(/setInterval|setTimeout|Scheduler|cron/);
    const handlers = files.filter((f) => /EventHandler|registerHandler/.test(strip(readFileSync(f, 'utf8'))) && !f.endsWith('index.ts')).map((f) => path.relative(MODULE, f).replace(/\\/g, '/'));
    expect(handlers).toEqual(['application/handlers/mark-teacher-absent-on-session-end.ts']);
    const handler = read('application/handlers/mark-teacher-absent-on-session-end.ts');
    expect(handler).not.toMatch(/STUDENT|student/i);
    const service = read('application/services/attendance-service.ts');
    const system = service.slice(service.indexOf('markTeacherAbsentForCompletedSession'), service.indexOf('async getSessionAttendance'));
    expect(system).toMatch(/'TEACHER'/);
    expect(system).not.toMatch(/'STUDENT'|smartGuard/);
  });

  it('does no notification work (deferred to Modules 31-34) and imports no notification, audit or teaching-record module', () => {
    for (const f of files) expect(strip(readFileSync(f, 'utf8')), f).not.toMatch(/notif|reminder|sendMessage|sendPush/i);
    expect(imports.filter(({ spec }) => /\/(2[7-9]|3\d)-/.test(spec))).toEqual([]);
  });

  it('Teacher actions go through Smart Guard; School Manager actions never do', () => {
    const service = read('application/services/attendance-service.ts');
    expect(service).toMatch(/smartGuard\.check/);
    const manager = service.slice(service.indexOf('async setTeacherAttendanceByManager'), service.indexOf('async getSessionAttendance'));
    expect(manager.length).toBeGreaterThan(200);
    expect(manager).not.toMatch(/smartGuard|guard\(/);
  });

  it('has exactly the six approved endpoints, none that deletes or reads the history', () => {
    const routes = read('presentation/http/attendance-routes.ts');
    expect([...routes.matchAll(/router\.(get|post|put|patch|delete)\(\s*'([^']*)'/g)].map((m) => `${m[1]} ${m[2]}`)).toEqual([
      'get /students/:id', 'get /sessions/:id', 'post /sessions/:id/students', 'post /sessions/:id/teacher/check-in', 'put /sessions/:id/teacher', 'put /sessions/:id/students/:studentId',
    ]);
  });
});
