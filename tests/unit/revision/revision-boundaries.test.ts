import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { registerAllErrorMessages } from '../../../src/app/bootstrap/register-error-messages';
import { defaultMessageCatalog } from '../../../src/modules/03-error-localization/public';
import { REVISION_ERROR_MESSAGES, RevisionErrorCodes, RevisionPermissions, registerRevisionAuthorization } from '../../../src/modules/28-revision/public';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? sourceFiles(full) : full.endsWith('.ts') ? [full] : [];
  });
}
const strip = (text: string) => text.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');
const MODULE = path.resolve(__dirname, '../../../src/modules/28-revision');
const files = sourceFiles(MODULE);
const read = (rel: string) => strip(readFileSync(path.join(MODULE, rel), 'utf8'));
const imports = files.flatMap((file) => [...readFileSync(file, 'utf8').matchAll(/from '([^']+)'/g)].map((m) => ({ file, spec: m[1]! })));

describe('Revision error messages', () => {
  it('has Arabic and English text for every code, and nothing else', () => {
    expect(REVISION_ERROR_MESSAGES.map((m) => m.code).sort()).toEqual(Object.values(RevisionErrorCodes).sort());
    for (const m of REVISION_ERROR_MESSAGES) {
      expect(m.message.ar.length).toBeGreaterThan(0);
      expect(m.message.en.length).toBeGreaterThan(0);
    }
  });
  it('are registered with the application', () => {
    registerAllErrorMessages();
    for (const c of Object.values(RevisionErrorCodes)) expect(defaultMessageCatalog.has(c), c).toBe(true);
  });
});

describe('Revision authorization', () => {
  it('registers exactly the approved roles: only the TEACHER records, corrects or defines assignments; the School Manager only reads', () => {
    const registered: Array<{ code: string; roles: string[] }> = [];
    registerRevisionAuthorization({ policies: { register: (p: { code: string; roles: readonly string[] }) => void registered.push({ code: p.code, roles: [...p.roles] }) } as never });
    const rolesOf = (code: string) => registered.find((r) => r.code === code)?.roles;
    expect(rolesOf(RevisionPermissions.RECORD)).toEqual(['TEACHER']);
    expect(rolesOf(RevisionPermissions.CORRECT)).toEqual(['TEACHER']);
    expect(rolesOf(RevisionPermissions.MANAGE_ASSIGNMENT)).toEqual(['TEACHER']);
    expect(rolesOf(RevisionPermissions.READ_SESSION)).toEqual(['SCHOOL_MANAGER', 'TEACHER']);
    expect(rolesOf(RevisionPermissions.READ_STUDENT)).toEqual(['SCHOOL_MANAGER', 'PARENT']);
    expect(registered).toHaveLength(5); // a Student has no read permission in this module
  });
});

describe('Revision boundaries', () => {
  it('imports other modules only through their public contract, and only lower-numbered modules', () => {
    expect(imports.filter(({ spec }) => /\/\d{2}-[a-z-]+\//.test(spec) && !/\/\d{2}-[a-z-]+\/public$/.test(spec))).toEqual([]);
    expect(imports.filter(({ spec }) => { const m = /\/(\d{2})-[a-z-]+\/public$/.exec(spec); return m !== null && Number(m[1]) >= 27; })).toEqual([]);
  });

  it('its code dependencies are exactly Modules 00, 02, 03, 04, 06, 12, 16, 18, 19, 20, 22, 24 and 25 (no notification, audit or attendance module)', () => {
    const used = new Set(imports.map(({ spec }) => /\/(\d{2})-[a-z-]+\/public$/.exec(spec)?.[1]).filter(Boolean));
    expect([...used].sort()).toEqual(['00', '02', '03', '04', '06', '12', '16', '18', '19', '20', '22', '24', '25']);
  });

  it('reads and writes only its own four tables', () => {
    const tables = new Set<string>();
    for (const f of files) for (const m of strip(readFileSync(f, 'utf8')).matchAll(/\b(?:FROM|INTO|UPDATE|JOIN)\s+([a-z_]+)/g)) tables.add(m[1]!);
    expect([...tables].sort()).toEqual(['revision_assignment_history', 'revision_assignments', 'revision_correction_history', 'revision_records']);
  });

  it('never deletes: no DELETE / TRUNCATE / DROP / destroy anywhere in the module', () => {
    for (const f of files) expect(strip(readFileSync(f, 'utf8')), f).not.toMatch(/\bDELETE\s+FROM\b|\.destroy\(|\bTRUNCATE\b|\bDROP\s+TABLE\b/i);
  });

  it('both histories are APPEND-ONLY: only ever INSERTed into', () => {
    for (const f of files) {
      const code = strip(readFileSync(f, 'utf8'));
      expect(code, f).not.toMatch(/UPDATE\s+revision_(assignment|correction)_history/i);
    }
    const repo = read('infrastructure/persistence/sequelize/repositories/sequelize-revision-repository.ts');
    expect(repo).toMatch(/INSERT INTO revision_correction_history/);
    expect(repo).toMatch(/INSERT INTO revision_assignment_history/);
    expect(read('application/ports/revision-repository.ts')).not.toMatch(/delete|remove/i);
  });

  it('records are never overwritten: the record UPDATE changes only the corrected range, its evaluation and the updater (never the session, student, assignment or recorder)', () => {
    const repo = read('infrastructure/persistence/sequelize/repositories/sequelize-revision-repository.ts');
    const update = /UPDATE revision_records SET ([^W]*?) WHERE/.exec(repo)?.[1] ?? '';
    expect(update.replace(/\s+/g, ' ').trim()).toBe('range_json = :rangeJson, matches_assignment = :matches, updated_by = :updatedBy, updated_at = :updatedAt');
  });

  it('is deterministic apart from the injected clock and has no timer, job or scheduler', () => {
    for (const f of files) {
      const code = strip(readFileSync(f, 'utf8'));
      expect(code, f).not.toMatch(/\b(Date\.now|new Date\(\s*\)|Math\.random)/);
      expect(code, f).not.toMatch(/setInterval|setTimeout|Scheduler|cron/);
    }
  });

  it('does no notification work (deferred to Modules 31-34) and never creates a record on its own', () => {
    for (const f of files) expect(strip(readFileSync(f, 'utf8')), f).not.toMatch(/notif|sendMessage|sendPush/i);
    const service = read('application/services/revision-service.ts');
    expect(service.match(/RevisionRecord\.record\(/g)).toHaveLength(1); // only in recordRevision, from the Teacher's request
    const reads = service.slice(service.indexOf('async getScheduledRevision'), service.indexOf('listCorrectionsOfSession'));
    expect(reads).not.toMatch(/insert|\.record\(|define\(|unitOfWork/);
  });

  it('recording and correcting go through Smart Guard; defining or changing an assignment does not (not a GPS action in the approved decisions)', () => {
    const service = read('application/services/revision-service.ts');
    expect(service).toMatch(/smartGuard\.check/);
    const rec = service.slice(service.indexOf('async recordRevision'), service.indexOf('async getSessionRevision'));
    expect(rec.match(/this\.guard\(/g)).toHaveLength(2);
    const assignments = service.slice(service.indexOf('async defineAssignment'), service.indexOf('async recordRevision'));
    expect(assignments).not.toMatch(/smartGuard|this\.guard\(/);
  });

  it('has exactly the seven approved endpoints: no delete, nothing for a School Manager to record or correct, no history read', () => {
    const routes = read('presentation/http/revision-routes.ts');
    expect([...routes.matchAll(/router\.(get|post|put|patch|delete)\(\s*'([^']*)'/g)].map((m) => `${m[1]} ${m[2]}`)).toEqual([
      'get /students/:id/records', 'get /sessions/:id', 'post /sessions/:id/assignments', 'put /assignments/:id', 'post /assignments/:id/cancel', 'post /sessions/:id/records', 'put /records/:id',
    ]);
  });
});
