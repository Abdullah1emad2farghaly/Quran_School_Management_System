import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { registerAllErrorMessages } from '../../../src/app/bootstrap/register-error-messages';
import { defaultMessageCatalog } from '../../../src/modules/03-error-localization/public';
import { EVALUATION_ERROR_MESSAGES, EvaluationErrorCodes, EvaluationPermissions } from '../../../src/modules/29-evaluations/public';
import { createAuthorizationHarness } from '../../helpers/authorization-harness';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? sourceFiles(full) : full.endsWith('.ts') ? [full] : [];
  });
}
const strip = (text: string) => text.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');
const SRC = path.resolve(__dirname, '../../../src');
const MODULE = path.join(SRC, 'modules/29-evaluations');
const files = sourceFiles(MODULE);
const imports = files.flatMap((file) => [...strip(readFileSync(file, 'utf8')).matchAll(/from '([^']+)'/g)].map((m) => ({ file, spec: m[1]! })));
const code = files.map((f) => strip(readFileSync(f, 'utf8'))).join('\n');

describe('Module 29 error messages', () => {
  it('has Arabic and English text for every code, and nothing else', () => {
    expect(EVALUATION_ERROR_MESSAGES.map((m) => m.code).sort()).toEqual(Object.values(EvaluationErrorCodes).sort());
    for (const m of EVALUATION_ERROR_MESSAGES) {
      expect(m.message.ar.length).toBeGreaterThan(0);
      expect(m.message.en.length).toBeGreaterThan(0);
    }
  });
  it('are registered, and the parametrised ones render', () => {
    registerAllErrorMessages();
    for (const c of Object.values(EvaluationErrorCodes)) expect(defaultMessageCatalog.has(c), c).toBe(true);
    expect(defaultMessageCatalog.message('EVALUATION_NOTE_TOO_LONG', 'en', { max: 200 })).toContain('200');
    expect(defaultMessageCatalog.message('EVALUATION_GRACE_CREATE_ONLY', 'en', { minutes: 15 })).toContain('15');
  });
  it('the attendance message for the new rule is registered too', () => {
    registerAllErrorMessages();
    expect(defaultMessageCatalog.has('ATTENDANCE_STUDENT_ALREADY_EVALUATED')).toBe(true);
  });
});

describe('Module 29 boundaries', () => {
  it('imports other modules only through their public contract, and only lower-numbered modules', () => {
    expect(imports.filter(({ spec }) => /\/\d{2}-[a-z-]+\//.test(spec) && !/\/\d{2}-[a-z-]+\/public$/.test(spec))).toEqual([]);
    expect(imports.filter(({ spec }) => { const m = /\/(\d{2})-[a-z-]+\/public$/.exec(spec); return m !== null && Number(m[1]) >= 29; })).toEqual([]);
  });

  it('depends on Attendance (26), Memorization (27) and Revision (28) only through their services, and never on their repositories or tables', () => {
    expect(code).not.toMatch(/\b(?:FROM|JOIN|INTO|UPDATE)\s+(?:attendance_|memorization_|revision_)/i);
    expect(code).not.toMatch(/AttendanceRepository|MemorizationRepository|RevisionRepository/);
  });

  it('contains NO notification delivery, NO audit/history mechanism and no dependency on Modules 30-40 (nothing is notified or audited here)', () => {
    expect(imports.filter(({ spec }) => /3[0-9]-|4[0-9]-/.test(spec))).toEqual([]);
    expect(code).not.toMatch(/NotificationService|sendNotification|NotificationSender|evaluation_history|evaluation_corrections|previousScore|previous_score|history_audit/i);
  });

  it('never deletes an evaluation and never updates the note after the insert; no evaluation_history table exists', () => {
    const repo = readFileSync(path.join(MODULE, 'infrastructure/persistence/sequelize/repositories/sequelize-evaluation-repository.ts'), 'utf8');
    expect(strip(repo)).not.toMatch(/DELETE\s+FROM|TRUNCATE|DROP\s+TABLE/i);
    expect(strip(repo)).not.toMatch(/UPDATE\s+evaluations\s+SET[^`']*note/i);
    expect(strip(repo)).not.toMatch(/INSERT\s+INTO\s+evaluation_[a-z_]*history/i);
    const migration = readFileSync(path.resolve(SRC, '../database/migrations/20261103100000-create-evaluations.js'), 'utf8');
    expect([...migration.matchAll(/createTable\(\s*'([a-z_]+)'/g)].map((m) => m[1])).toEqual(['evaluations', 'evaluation_scores']);
  });

  it('has no School Manager write path and no correction permission: the only write permission is the Teacher\'s', () => {
    expect(Object.values(EvaluationPermissions).sort()).toEqual(['evaluation.record.record', 'evaluation.session.read', 'evaluation.student.read']);
    const routes = readFileSync(path.join(MODULE, 'presentation/http/evaluation-routes.ts'), 'utf8');
    expect([...strip(routes).matchAll(/router\.(get|post|put|patch|delete)\(/g)].map((m) => m[1])).toEqual(['get', 'get', 'post']);
  });

  it('Module 26 never imports Module 29 (the veto is a port plugged in by the composition root), and the root wires it', () => {
    const attendance = sourceFiles(path.join(SRC, 'modules/26-attendance')).map((f) => strip(readFileSync(f, 'utf8'))).join('\n');
    expect(attendance).not.toMatch(/29-evaluations/);
    const config = readFileSync(path.join(SRC, 'config/attendance.ts'), 'utf8');
    expect(config).toMatch(/evaluationGuard:\s*\{\s*findEvaluatedStudents/);
  });

  it('Memorization, Revision and Attendance do not use the Smart Guard grace exception, and are unchanged by Module 29', () => {
    for (const m of ['26-attendance', '27-memorization', '28-revision']) {
      expect(sourceFiles(path.join(SRC, 'modules', m)).map((f) => readFileSync(f, 'utf8')).join('\n')).not.toMatch(/allowAfterEndMinutes/);
    }
  });
});

describe('permissions (registered through the Authorization Engine)', () => {
  it('registers exactly the evaluation permissions, with the approved roles', async () => {
    const h = await createAuthorizationHarness();
    const { registerEvaluationAuthorization } = await import('../../../src/modules/29-evaluations/public');
    const registered: Array<{ code: string; roles: string[] }> = [];
    registerEvaluationAuthorization({ policies: { register: (p: { code: string; roles: readonly string[] }) => void registered.push({ code: p.code, roles: [...p.roles] }) } as never });
    expect(registered).toEqual([
      { code: 'evaluation.record.record', roles: ['TEACHER'] },
      { code: 'evaluation.session.read', roles: ['SCHOOL_MANAGER', 'TEACHER'] },
      { code: 'evaluation.student.read', roles: ['SCHOOL_MANAGER', 'PARENT'] },
    ]);
    expect(h).toBeDefined();
  });
});
