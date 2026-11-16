import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { registerAllErrorMessages } from '../../../src/app/bootstrap/register-error-messages';
import { defaultMessageCatalog } from '../../../src/modules/03-error-localization/public';
import { SCHEDULE_ERROR_MESSAGES, ScheduleErrorCodes } from '../../../src/modules/23-group-schedules/public';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? sourceFiles(full) : full.endsWith('.ts') ? [full] : [];
  });
}
const strip = (text: string) => text.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');
const ROOT = path.resolve(__dirname, '../../..');
const MODULE = path.join(ROOT, 'src/modules/23-group-schedules');
const files = sourceFiles(MODULE);

describe('Module 23 error messages', () => {
  it('has Arabic and English text for every schedule error code, and nothing else', () => {
    expect(SCHEDULE_ERROR_MESSAGES.map((m) => m.code).sort()).toEqual(Object.values(ScheduleErrorCodes).sort());
    for (const m of SCHEDULE_ERROR_MESSAGES) {
      expect(m.message.ar.length).toBeGreaterThan(0);
      expect(m.message.en.length).toBeGreaterThan(0);
    }
  });
  it('are registered with the application', () => {
    registerAllErrorMessages();
    for (const c of Object.values(ScheduleErrorCodes)) expect(defaultMessageCatalog.has(c), c).toBe(true);
  });
});

describe('Module 23 boundaries', () => {
  const imports = files.flatMap((file) => [...readFileSync(file, 'utf8').matchAll(/from '([^']+)'/g)].map((m) => ({ file, spec: m[1]! })));

  it('imports other modules only through their public contract, and only lower-numbered modules', () => {
    expect(imports.filter(({ spec }) => /\/\d{2}-[a-z-]+\//.test(spec) && !/\/\d{2}-[a-z-]+\/public$/.test(spec))).toEqual([]);
    expect(imports.filter(({ spec }) => { const m = /\/(\d{2})-[a-z-]+\/public$/.exec(spec); return m !== null && Number(m[1]) >= 23; })).toEqual([]);
  });

  it('never deletes a slot: no DELETE statement and no destroy call anywhere in the module (retired slots are history)', () => {
    for (const f of files) expect(strip(readFileSync(f, 'utf8')), f).not.toMatch(/\bDELETE\s+FROM\b|\.destroy\(|\bTRUNCATE\b|\bDROP\s+TABLE\b/i);
  });

  it('reads and writes only its own tables (group_schedule_slots and schedule_teacher_locks)', () => {
    const tables = new Set<string>();
    for (const f of files) for (const m of strip(readFileSync(f, 'utf8')).replace(/ON DUPLICATE KEY UPDATE/g, '').matchAll(/\b(?:FROM|INTO|UPDATE|JOIN)\s+([a-z_]+)/g)) tables.add(m[1]!);
    expect([...tables].filter((t) => !['group_schedule_slots', 'schedule_teacher_locks'].includes(t))).toEqual([]);
  });

  it('is deterministic apart from the injected clock: no Date.now / new Date / Math.random', () => {
    for (const f of files) expect(strip(readFileSync(f, 'utf8')), f).not.toMatch(/\b(Date\.now|new Date\(\s*\)|Math\.random)/);
  });
});
